from __future__ import annotations
import heapq, math, os, statistics, subprocess, tempfile
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

INTRO_SECONDS=360
TAIL_AUDIO_SECONDS=480
TAIL_VISUAL_SECONDS=180
VISUAL_FPS=2
VISUAL_WIDTH=64
VISUAL_HEIGHT=36
VISUAL_FRAME_BYTES=VISUAL_WIDTH*VISUAL_HEIGHT
MAX_AUDIO_CANDIDATES=2000

def _validate_media_url(url:str)->str:
    value=str(url or "").strip()
    parsed=urlparse(value)
    host=(parsed.hostname or "").lower().strip(".")
    if parsed.scheme not in ("http","https") or not host:
        raise ValueError("INVALID_MEDIA_URL")
    if host!="energycdn.com" and not host.endswith(".energycdn.com"):
        raise ValueError("UNSUPPORTED_MEDIA_HOST")
    return value

def _run(cmd:List[str], timeout:int)->subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("MEDIA_TOOL_TIMEOUT") from exc

def _fpcalc(path:str, requested_seconds:int)->Tuple[List[int],float]:
    p=_run(["fpcalc","-raw","-length",str(requested_seconds),path],90)
    if p.returncode!=0:
        raise RuntimeError("FPCALC_FAILED:"+p.stderr.decode("utf-8","replace")[-1000:])
    duration=None; fingerprint=None
    for line in p.stdout.decode("utf-8","replace").splitlines():
        if line.startswith("DURATION="):
            duration=float(line.split("=",1)[1].strip())
        elif line.startswith("FINGERPRINT="):
            raw=line.split("=",1)[1].strip()
            fingerprint=[int(x)&0xffffffff for x in raw.split(",") if x]
    if not fingerprint:
        raise RuntimeError("NO_FINGERPRINT")
    return fingerprint, float(duration or requested_seconds)

def _extract_audio_fp(url:str,duration_sec:float,seconds:int,tail:bool)->Dict[str,Any]:
    fd,path=tempfile.mkstemp(prefix="privastream-segments-",suffix=".wav"); os.close(fd)
    try:
        cmd=["ffmpeg","-hide_banner","-loglevel","error","-rw_timeout","15000000"]
        if tail: cmd += ["-sseof","-"+str(seconds)]
        cmd += ["-i",url,"-t",str(seconds),"-map","0:a:0","-vn","-ac","1","-ar","11025","-c:a","pcm_s16le","-y",path]
        p=_run(cmd,180)
        if p.returncode!=0:
            err=p.stderr.decode("utf-8","replace").replace(url,"[SIGNED_URL]")
            raise RuntimeError("FFMPEG_AUDIO_FAILED:"+err[-1200:])
        fp,fp_duration=_fpcalc(path,seconds)
        return {"fingerprint":fp,"fp_duration_sec":fp_duration,"start_sec":max(0.0,float(duration_sec)-float(seconds)) if tail else 0.0}
    finally:
        try: os.remove(path)
        except OSError: pass

def _visual_features(url:str,duration_sec:float)->Dict[str,Any]:
    cmd=["ffmpeg","-hide_banner","-loglevel","error","-rw_timeout","15000000","-sseof","-"+str(TAIL_VISUAL_SECONDS),"-i",url,"-an","-vf",f"fps={VISUAL_FPS},scale={VISUAL_WIDTH}:{VISUAL_HEIGHT},format=gray","-pix_fmt","gray","-f","rawvideo","pipe:1"]
    p=_run(cmd,180)
    if p.returncode!=0:
        err=p.stderr.decode("utf-8","replace").replace(url,"[SIGNED_URL]")
        raise RuntimeError("FFMPEG_VIDEO_FAILED:"+err[-1200:])
    raw=p.stdout
    frame_count=len(raw)//VISUAL_FRAME_BYTES
    frames=[raw[i*VISUAL_FRAME_BYTES:(i+1)*VISUAL_FRAME_BYTES] for i in range(frame_count)]
    if frame_count < VISUAL_FPS*40:
        raise RuntimeError("TOO_FEW_VISUAL_FRAMES")
    out=[]; prev=None
    for frame in frames:
        px=list(frame); brightness=sum(px)/len(px); variance=sum((v-brightness)**2 for v in px)/len(px); contrast=math.sqrt(variance)
        edge_sum=0.0; edge_count=0
        for y in range(VISUAL_HEIGHT):
            base=y*VISUAL_WIDTH
            for x in range(VISUAL_WIDTH-1):
                edge_sum += abs(px[base+x+1]-px[base+x]); edge_count+=1
        for y in range(VISUAL_HEIGHT-1):
            b1=y*VISUAL_WIDTH; b2=(y+1)*VISUAL_WIDTH
            for x in range(VISUAL_WIDTH):
                edge_sum += abs(px[b2+x]-px[b1+x]); edge_count+=1
        edge=edge_sum/max(edge_count,1)
        motion=0.0 if prev is None else sum(abs(a-b) for a,b in zip(px,prev))/len(px)
        out.append({"brightness":brightness,"contrast":contrast,"edge":edge,"motion":motion})
        prev=px
    return {"fps":VISUAL_FPS,"start_sec":max(0.0,float(duration_sec)-float(TAIL_VISUAL_SECONDS)),"features":out}

def extract_signature(url:str,duration_sec:float)->Dict[str,Any]:
    media_url=_validate_media_url(url); duration=float(duration_sec)
    if duration<=0: raise ValueError("INVALID_DURATION")
    return {"schema_version":1,"duration_sec":duration,
            "intro":_extract_audio_fp(media_url,duration,INTRO_SECONDS,False),
            "tail_audio":_extract_audio_fp(media_url,duration,TAIL_AUDIO_SECONDS,True),
            "tail_visual":_visual_features(media_url,duration)}

def _similarity(a:int,b:int)->float:
    return 1.0-(((a^b)&0xffffffff).bit_count()/32.0)

def _activity_prefix(fp:List[int])->List[float]:
    vals=[0.0]*len(fp)
    for i in range(1,len(fp)): vals[i]=(((fp[i]^fp[i-1])&0xffffffff).bit_count()/32.0)
    pref=[0.0]
    for v in vals: pref.append(pref[-1]+v)
    return pref

def _avg_range(pref:List[float],start:int,end:int)->float:
    return 0.0 if end<=start else (pref[end]-pref[start])/(end-start)

def _audio_align(fp_a:List[int],dur_a:float,fp_b:List[int],dur_b:float,window_sec:float)->Optional[Dict[str,Any]]:
    if not fp_a or not fp_b or dur_a<=0 or dur_b<=0: return None
    sec_per_a=dur_a/len(fp_a); sec_per_b=dur_b/len(fp_b); sec_per=(sec_per_a+sec_per_b)/2.0
    window=max(20,round(window_sec/sec_per))
    if len(fp_a)<window or len(fp_b)<window: return None
    act_a=_activity_prefix(fp_a); act_b=_activity_prefix(fp_b); heap=[]
    for shift in range(-(len(fp_a)-window), len(fp_b)-window+1):
        a_start=max(0,-shift); a_end=min(len(fp_a),len(fp_b)-shift)
        if a_end-a_start<window: continue
        sims=[_similarity(fp_a[i],fp_b[i+shift]) for i in range(a_start,a_end)]
        rolling=sum(sims[:window])
        for pos in range(0,len(sims)-window+1):
            if pos>0: rolling += sims[pos+window-1]-sims[pos-1]
            ia=a_start+pos; ib=ia+shift
            activity=min(_avg_range(act_a,ia,ia+window),_avg_range(act_b,ib,ib+window))
            if activity<0.025: continue
            item=(rolling/window,activity,ia,ib)
            if len(heap)<MAX_AUDIO_CANDIDATES: heapq.heappush(heap,item)
            elif item>heap[0]: heapq.heapreplace(heap,item)
    if not heap: return None
    ranked=sorted(heap,reverse=True); distinct=[]; dedupe=max(1,round(8.0/sec_per))
    for score,activity,ia,ib in ranked:
        if any(abs(ia-o["a"])<=dedupe and abs(ib-o["b"])<=dedupe for o in distinct): continue
        distinct.append({"score":score,"activity":activity,"a":ia,"b":ib})
        if len(distinct)>=10: break
    if not distinct: return None
    best=distinct[0]; chunk=max(4,round(1.5/sec_per)); threshold=max(0.58,best["score"]-0.20)
    la,lb=best["a"],best["b"]; ra,rb=best["a"]+window,best["b"]+window
    def cs(a0,b0,n):
        if a0<0 or b0<0 or a0+n>len(fp_a) or b0+n>len(fp_b): return None
        return sum(_similarity(fp_a[a0+k],fp_b[b0+k]) for k in range(n))/n
    while True:
        s=cs(la-chunk,lb-chunk,chunk)
        if s is None or s<threshold: break
        la-=chunk; lb-=chunk
    while True:
        s=cs(ra,rb,chunk)
        if s is None or s<threshold: break
        ra+=chunk; rb+=chunk
    a0=la*sec_per; a1=ra*sec_per; b0=lb*sec_per; b1=rb*sec_per
    length=min(a1-a0,b1-b0); second=distinct[1]["score"] if len(distinct)>1 else 0.0
    conf=max(0.0,min(1.0,best["score"]*0.75+max(0.0,best["score"]-second)*0.50+min(length/30.0,1.0)*0.25))
    return {"a_start_sec":a0,"a_end_sec":a1,"b_start_sec":b0,"b_end_sec":b1,"length_sec":length,"core_score":best["score"],"confidence":conf,"expand_threshold":threshold}

def _visual_candidates(sig:Dict[str,Any])->List[Dict[str,float]]:
    block=sig["tail_visual"]; features=block["features"]; fps=int(block["fps"]); start_sec=float(block["start_sec"]); duration=float(sig["duration_sec"]); n=len(features)
    scales={}
    for name in ("brightness","contrast","edge","motion"):
        vals=[float(f[name]) for f in features]; scales[name]=max(statistics.pstdev(vals),0.001)
    pre=fps*8; post=fps*12; candidates=[]
    for i in range(fps*15,n-fps*15):
        if i-pre<0 or i+post>=n: continue
        score=0.0
        for name,weight in (("brightness",1.0),("contrast",1.0),("edge",1.25),("motion",1.50)):
            before=[float(features[k][name]) for k in range(i-pre,i)]
            after=[float(features[k][name]) for k in range(i,i+post)]
            score += abs(sum(after)/len(after)-sum(before)/len(before))/scales[name]*weight
        bm=[float(features[k]["motion"]) for k in range(i-pre,i)]
        am=[float(features[k]["motion"]) for k in range(i,i+post)]
        score += max(0.0,statistics.pstdev(bm)-statistics.pstdev(am))/scales["motion"]*1.25
        absolute=start_sec+i/fps
        candidates.append({"index":float(i),"score":score,"absolute_sec":absolute,"remaining_sec":duration-absolute})
    candidates.sort(key=lambda x:x["score"],reverse=True); distinct=[]
    for c in candidates:
        if any(abs(c["index"]-o["index"])<fps*8 for o in distinct): continue
        distinct.append(c)
        if len(distinct)>=15: break
    return distinct

def compare_signatures(sig_a:Dict[str,Any],sig_b:Dict[str,Any])->Dict[str,Any]:
    ia=sig_a["intro"]; ib=sig_b["intro"]
    intro=_audio_align(ia["fingerprint"],float(ia["fp_duration_sec"]),ib["fingerprint"],float(ib["fp_duration_sec"]),16.0)
    ta=sig_a["tail_audio"]; tb=sig_b["tail_audio"]
    ca=_audio_align(ta["fingerprint"],float(ta["fp_duration_sec"]),tb["fingerprint"],float(tb["fp_duration_sec"]),20.0)
    result={"intro":None,"credits":None,"credits_audio":ca}
    if intro and intro["core_score"]>=0.85 and intro["length_sec"]>=18.0: result["intro"]=intro
    # V723_CORROBORATED_CREDITS
    # Preserve the existing strong path while allowing a conservative
    # near-threshold recurring-audio candidate to reach independent
    # visual-boundary corroboration.
    if (
        not ca
        or ca["core_score"] < 0.80
        or ca["length_sec"] < 18.0
    ):
        return result
    da=float(sig_a["duration_sec"]); db=float(sig_b["duration_sec"])
    anchor_a=float(ta["start_sec"])+ca["a_start_sec"]; anchor_b=float(tb["start_sec"])+ca["b_start_sec"]
    rem_anchor_a=da-anchor_a; rem_anchor_b=db-anchor_b
    pairs=[]
    for a in _visual_candidates(sig_a):
        for b in _visual_candidates(sig_b):
            delta=abs(a["remaining_sec"]-b["remaining_sec"])
            if delta>6.0: continue
            if a["remaining_sec"]<rem_anchor_a+10.0 or b["remaining_sec"]<rem_anchor_b+10.0: continue
            pair_score=a["score"]+b["score"]+((6.0-delta)/6.0)*3.0
            pairs.append({"pair_score":pair_score,"remaining_delta_sec":delta,"a":a,"b":b})
    if not pairs: return result
    pairs.sort(key=lambda x:x["pair_score"],reverse=True); best=pairs[0]
    result["credits"]={"a_start_sec":best["a"]["absolute_sec"],"b_start_sec":best["b"]["absolute_sec"],
                       "a_remaining_sec":best["a"]["remaining_sec"],"b_remaining_sec":best["b"]["remaining_sec"],
                       "remaining_delta_sec":best["remaining_delta_sec"],"pair_score":best["pair_score"],
                       "audio_anchor_a_sec":anchor_a,"audio_anchor_b_sec":anchor_b,
                       "audio_core_score":ca["core_score"],"audio_confidence":ca["confidence"],
                       "audio_length_sec":ca["length_sec"]}
    return result
