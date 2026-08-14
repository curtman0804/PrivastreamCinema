export type RowApi={getCount:()=>number;scrollToCol:(c:number)=>void;press:(c:number)=>void;longPress?:(c:number)=>void;focus?:(c:number)=>void;};
let _row=0;let _col=0;let _active=false;
const _rows=new Map<number,RowApi>();const _subs=new Set<()=>void>();const _rowSubs=new Map<number,Set<()=>void>>();
let _orc:((r:number,c:number)=>void)|null=null;
function _emit(){_subs.forEach(cb=>{try{cb()}catch(_){}})}
function _er(r:number){const s=_rowSubs.get(r);if(s)s.forEach(cb=>{try{cb()}catch(_){}})}
export function tvState(){return{row:_row,col:_col,active:_active}}
export function tvSubscribe(cb:()=>void){_subs.add(cb);return()=>{_subs.delete(cb)}}
export function tvSubscribeRow(r:number,cb:()=>void){let s=_rowSubs.get(r);if(!s){s=new Set();_rowSubs.set(r,s)}s.add(cb);return()=>{const x=_rowSubs.get(r);if(x)x.delete(cb)}}
function _cnt(r:number){const a=_rows.get(r);return a?Math.max(0,a.getCount()):0}
function _eff(r:number){const n=_cnt(r);if(n<=0)return 0;return Math.min(Math.max(0,_col),n-1)}
const _sc=()=>Math.max(0,_col);
export function tvRegisterRow(r:number,a:RowApi){_rows.set(r,a);try{a.scrollToCol(_sc())}catch(_){}_emit()}
export function tvUnregisterRow(r:number){_rows.delete(r)}
export function tvSetOnRowChange(f:((r:number,c:number)=>void)|null){_orc=f}
export function tvSetActive(a:boolean){if(_active===a)return;_active=a;_emit();_er(_row)}
function _sr(){return Array.from(_rows.keys()).sort((a,b)=>a-b)}
function _all(){_rows.forEach(a=>{try{a.scrollToCol(_sc())}catch(_){}})}
export function tvMove(d:"up"|"down"|"left"|"right"){
if(!_active)return;
if(d==="left"){if(_col>0){_col-=1;_all();_emit()}return}
if(d==="right"){const e=_eff(_row);const n=_cnt(_row);if(n>0&&e<n-1){_col=e+1;_all();_emit()}return}
const rs=_sr();if(!rs.length)return;let i=rs.indexOf(_row);if(i<0){i=0;for(let k=0;k<rs.length;k++){if(rs[k]>=_row){i=k;break}i=k}}
if(d==="down"){if(i<rs.length-1)_set(rs[i+1])}else{if(i>0)_set(rs[i-1])}}
function _set(r:number){const p=_row;_row=r;_er(p);_er(r);_emit();const a=_rows.get(r);if(a){try{a.scrollToCol(_sc())}catch(_){}}try{_orc&&_orc(_row,_eff(r))}catch(_){}}
export function tvPress(){if(!_active)return;const a=_rows.get(_row);if(a){try{a.press(_eff(_row))}catch(_){}}}
export function tvLongSelect(){if(!_active)return;const a=_rows.get(_row);if(a&&a.longPress){try{a.longPress(_eff(_row))}catch(_){}}}
export function tvEffCol(c:number){if(c<=0)return 0;return Math.min(Math.max(0,_col),c-1)}
export function tvReset(r=0,c=0){_row=r;_col=c;_emit()}