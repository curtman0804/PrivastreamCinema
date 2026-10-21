// W121ZLIVE148I: Persistent single loader for guide -> Live player route.
// Root-owned Modal stays mounted above the React Navigation Stack.
// No playback URL/decoder/buffering/commercial/on-demand ownership.
import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'expo-router';
import { Animated, DeviceEventEmitter, Easing, Image, Modal, Text, View } from 'react-native';

type Cover = { addonId: string; contentId: string; title: string; logo: string; kind?: 'od'; key?: string; backdrop?: string };

export default function W121ZLIVE148IRootCover() {
  const [cover, setCover] = useState<Cover | null>(null);
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [longWait, setLongWait] = useState(false);
  const coverRef = useRef<Cover | null>(null);
  const bar = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    const same = (e: any) => {
      const current = coverRef.current;
      return !!current && current.kind !== 'od' &&
        current.addonId === String(e?.addonId || '') &&
        current.contentId === String(e?.contentId || '');
    };
    const begin = DeviceEventEmitter.addListener('W121ZLIVE148I_COVER_BEGIN', (e: any) => {
      const addonId = String(e?.addonId || '');
      const contentId = String(e?.contentId || '');
      if (!addonId || !contentId) return;
      if (coverRef.current) {
        console.log('[W121ZLIVE148I COVER ALREADY ACTIVE]');
        return;
      }
      const next = {
        addonId, contentId,
        title: String(e?.title || contentId),
        logo: String(e?.logo || ''),
      };
      coverRef.current = next;
      setLongWait(false);
      setCover(next);
      console.log('[W121ZLIVE148I ROOT MODAL OPEN]', 'channel=' + addonId + ':' + contentId);
    });
    // W121ZOD148J: independent root-owned OD handoff. Only one Modal exists.
    const odBegin = DeviceEventEmitter.addListener('W121ZOD148J_COVER_BEGIN', (e: any) => {
      const key = String(e?.key || '');
      if (!key || coverRef.current) return;
      const next: Cover = {
        kind: 'od', key, addonId: '', contentId: '',
        title: String(e?.title || 'On Demand'),
        logo: String(e?.logo || ''), backdrop: String(e?.backdrop || ''),
      };
      coverRef.current = next;
      setLongWait(false); setCover(next);
      console.log('[W121ZOD148J ROOT COVER OPEN]', 'key=' + key);
    });
    const odEnd = DeviceEventEmitter.addListener('W121ZOD148J_PLAYER_COVER_END', (e: any) => {
      const current = coverRef.current;
      if (!current || current.kind !== 'od' || current.key !== String(e?.key || '')) return;
      console.log('[W121ZOD148J ROOT COVER CLOSE]', 'reason=' + String(e?.reason || ''));
      coverRef.current = null; setCover(null);
    });
    const odCancel = DeviceEventEmitter.addListener('W121ZOD148J_PREP_CANCEL', (e: any) => {
      const current = coverRef.current;
      if (!current || current.kind !== 'od' || current.key !== String(e?.key || '')) return;
      console.log('[W121ZOD148J ROOT COVER CANCEL]');
      coverRef.current = null; setCover(null);
    });
    const end = DeviceEventEmitter.addListener('W121ZLIVE148H_PLAYER_COVER_END', (e: any) => {
      if (!same(e)) return;
      console.log('[W121ZLIVE148I ROOT MODAL CLOSE]', 'reason=' + String(e?.reason || ''));
      coverRef.current = null;
      setCover(null);
    });
    const clear = DeviceEventEmitter.addListener('W121ZLIVE148I_COVER_CLEAR', (e: any) => {
      if (!coverRef.current) return;
      // Genuine return to guide needs to clear even after player navigation.
      if (e?.reason !== 'guide-focus' && !same(e)) return;
      console.log('[W121ZLIVE148I ROOT MODAL CLEAR]', 'reason=' + String(e?.reason || ''));
      coverRef.current = null;
      setCover(null);
    });
    return () => { begin.remove(); end.remove(); clear.remove(); odBegin.remove(); odEnd.remove(); odCancel.remove(); };
  }, []);

  useEffect(() => {
    if (!cover) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bar, { toValue: -100, duration: 0, useNativeDriver: true }),
      Animated.timing(bar, {
        toValue: 260, duration: 1200,
        easing: Easing.inOut(Easing.ease), useNativeDriver: true,
      }),
    ]));
    loop.start();
    // An upstream stream might never resolve. Keep the dark cover, but expose
    // an instruction to Back instead of silently flashing the EPG.
    const warning = setTimeout(() => setLongWait(true), 45000);
    return () => { loop.stop(); clearTimeout(warning); };
  }, [cover, bar]);

  const onBack = () => {
    const current = coverRef.current;
    if (!current) return;
    if (current.kind === 'od') {
      DeviceEventEmitter.emit('W121ZOD148J_COVER_BACK', { key: current.key });
      coverRef.current = null; setCover(null);
      // The existing player Smart Back handler owns its navigation.
      return;
    }
    DeviceEventEmitter.emit('W121ZLIVE148I_COVER_BACK' , {
      addonId: current.addonId, contentId: current.contentId,
    });
    coverRef.current = null;
    setCover(null);
  };

  return (
    <Modal visible={!!cover} transparent={false} animationType="none"
      statusBarTranslucent={true} navigationBarTranslucent={true}
      onRequestClose={onBack}>
      <View style={{flex:1, backgroundColor:'#000000',
        alignItems:'center', justifyContent:'center', paddingHorizontal:32}}>
        {cover?.kind === 'od' && !!cover?.backdrop && <Image
          source={{uri: cover.backdrop}} blurRadius={8} resizeMode="cover"
          style={{position:'absolute', top:0, left:0, right:0, bottom:0, width:'120%', height:'120%'}} />}
        {cover?.kind === 'od' && <View style={{position:'absolute', top:0, left:0, right:0, bottom:0,
          backgroundColor:'rgba(0,0,0,0.67)'}} />}

        {!!cover?.logo && <Image source={{uri:cover.logo}}
          style={{width:280,height:90,marginBottom:20}} resizeMode="contain" />}
        {!cover?.logo && !!cover?.title && <Text numberOfLines={2}
          style={{color:'#FFFFFF',fontSize:32,fontWeight:'800',textAlign:'center',
            marginBottom:16,letterSpacing:0.5}}>{cover.title}</Text>}
        <View style={{width:260,height:4,borderRadius:2,
          backgroundColor:'rgba(255,255,255,0.12)',overflow:'hidden'}}>
          <Animated.View style={{position:'absolute',top:0,left:0,width:100,height:4,
            borderRadius:2,backgroundColor:'#B8A05C',
            transform:[{translateX:bar}]}} />
        </View>
        <Text style={{color:'rgba(255,255,255,0.7)',fontSize:13,
          fontWeight:'500',letterSpacing:0.5,marginTop:16}}>
          {longWait ? (cover?.kind === 'od' ? 'Still loading. Press Back to cancel.' : 'Still loading. Press Back to return to Live TV.') : 'Loading...'}
        </Text>
      </View>
    </Modal>
  );
}
