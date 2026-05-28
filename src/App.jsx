import { RealMapView, RealStoreMap, PlacesSearchInput } from "./GoogleMaps";
import { useState, useEffect, useRef } from "react";

/* ─────────────────────────────────────────────
   FONTS
───────────────────────────────────────────── */
const FontLoader = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #E8DFC8; }
    @keyframes fadeUp   { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
    @keyframes fadeIn   { from{opacity:0} to{opacity:1} }
    @keyframes slideUp  { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }
    @keyframes floatEgg { 0%,100%{transform:translateY(0) rotate(-4deg)} 50%{transform:translateY(-10px) rotate(4deg)} }
    @keyframes pulse    { 0%,100%{box-shadow:0 0 0 0 rgba(44,111,172,0.4)} 50%{box-shadow:0 0 0 8px rgba(44,111,172,0)} }
    @keyframes popIn    { 0%{transform:scale(0.8);opacity:0} 70%{transform:scale(1.05)} 100%{transform:scale(1);opacity:1} }
    @keyframes spin     { to{transform:rotate(360deg)} }
    input[type=number]::-webkit-inner-spin-button,
    input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .fade-up   { animation: fadeUp  0.35s ease both }
    .fade-in   { animation: fadeIn  0.25s ease both }
    .slide-up  { animation: slideUp 0.4s cubic-bezier(.22,.68,0,1.2) both }
    .pop-in    { animation: popIn   0.45s cubic-bezier(.22,.68,0,1.2) both }
    ::-webkit-scrollbar { width: 0 }
    .hover-card { transition: transform 0.15s ease, box-shadow 0.15s ease; cursor: pointer; }
    .hover-card:active { transform: scale(0.98); }
    .btn-press { transition: transform 0.1s ease, filter 0.1s ease; cursor: pointer; }
    .btn-press:active { transform: scale(0.96); filter: brightness(0.92); }
  `}</style>
);

/* ─────────────────────────────────────────────
   API クライアント層
   ───────────────────────────────────────────────
   USE_API = false → モックデータで動作（Artifactプレビュー用）
   USE_API = true  → localhost:3000 のバックエンドに接続
                     （ローカルにコードを落として使う場合）
───────────────────────────────────────────── */
const USE_API   = true;                      // ← ローカルで繋ぐときは true に
const API_BASE  = import.meta.env.VITE_API_BASE || "http://localhost:3000";
const DEV_USER  = "97a3c260-639e-4aaa-88d2-18fa4b6de391";                          // ← seedで出たUUIDを入れる（dev認証の初期値）

// ログインで切り替えられる現在のユーザーID（dev認証）
let currentUserId = DEV_USER;
function setCurrentUser(id) { currentUserId = id; }

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function apiRequest(method, path, { body, query, auth } = {}) {
  const url = new URL(API_BASE + path);
  if (query) Object.entries(query).forEach(([k,v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const headers = { "Content-Type": "application/json" };
  if (auth && currentUserId) headers["x-dev-user-id"] = currentUserId;

  let res;
  try {
    res = await fetch(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new ApiError("サーバーに接続できません", 0);
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new ApiError((data && data.error) || `エラー (${res.status})`, res.status);
  return data;
}

const api = {
  getListings: (q)      => apiRequest("GET", "/listings", { query:q }),
  getListing:  (id)     => apiRequest("GET", `/listings/${id}`),
  createListing:(b)     => apiRequest("POST", "/listings", { body:b, auth:true }),
  updateListing:(id, b) => apiRequest("PUT", `/listings/${id}`, { body:b, auth:true }),
  join:        (id, n)  => apiRequest("POST", `/listings/${id}/applications`, { body:{ egg_count:n }, auth:true }),
  cancelApplication:(id)=> apiRequest("DELETE", `/applications/${id}`, { auth:true }),
  setListingStatus:(id,s)=> apiRequest("PATCH", `/listings/${id}/status`, { body:{ status:s }, auth:true }),
  deleteListing:(id)    => apiRequest("DELETE", `/listings/${id}`, { auth:true }),
  postReview:  (id, b)  => apiRequest("POST", `/listings/${id}/reviews`, { body:b, auth:true }),
  getMessages: (id, after)=> apiRequest("GET", `/listings/${id}/messages`, { query: after?{after}:undefined, auth:true }),
  sendMessage: (id, body)=> apiRequest("POST", `/listings/${id}/messages`, { body:{ body }, auth:true }),
  getBlocks:   ()       => apiRequest("GET", "/me/blocks", { auth:true }),
  blockUser:   (id)     => apiRequest("POST", `/users/${id}/block`, { auth:true }),
  unblockUser: (id)     => apiRequest("DELETE", `/users/${id}/block`, { auth:true }),
  getMyApplications:()  => apiRequest("GET", "/me/applications", { auth:true }),
  getMyListings:    ()  => apiRequest("GET", "/me/listings", { auth:true }),
};

/* バックエンドの listing（snake_case）→ UI形式に変換するアダプタ */
const AVATAR_COLORS = [
  {c:"#1A5FA0",bg:"#DCEEFF"},{c:"#A0401A",bg:"#FFE5DC"},{c:"#1A7A30",bg:"#E5FFE0"},
  {c:"#7A1AAF",bg:"#F5DCFF"},{c:"#A07A1A",bg:"#FFF5DC"},
];
function adaptListing(row) {
  const apps = row.applications || [];
  const members = apps.map((a, i) => ({
    n: (a.nickname || "?").slice(0,1),
    fullName: a.nickname || "メンバー",
    userId: a.user_id,
    ...AVATAR_COLORS[i % AVATAR_COLORS.length],
    eggs: a.egg_count,
    host: a.user_id === row.poster_id,
  }));
  // 主催者をメンバー先頭に
  members.unshift({
    n:(row.poster_nickname||"主").slice(0,1),
    fullName: row.poster_nickname || "主催者",
    userId: row.poster_id,
    c:C.warm, bg:C.light, eggs:row.poster_eggs, host:true,
  });
  return {
    id: row.id,
    poster_id: row.poster_id,
    store: row.store_name,
    store_lat: row.store_lat,
    store_lng: row.store_lng,
    dist: row.distance_m != null ? row.distance_m : 0,
    pack: row.pack_size,
    size: row.egg_size,
    price: row.price_total,
    poster_eggs: row.poster_eggs,
    time: row.meet_at,              // ISO文字列 → formatTimeで整形
    confirmed: row.confirmed_count,
    comment: row.comment,
    status: row.status,
    members,
    lat: 0.3 + Math.random()*0.4,   // マップ表示用のダミー座標
    lng: 0.2 + Math.random()*0.5,
    isPostedByMe: row.poster_id === currentUserId,
  };
}


/* ─────────────────────────────────────────────
   TOKENS
───────────────────────────────────────────── */
const C = {
  yolk:    "#E8920A", warm:   "#F5A623", warmDark: "#D4840A",
  light:   "#FEF0D0", shell:  "#FBF6EC", dark:     "#7B4F00",
  mid:     "#A0640D", ink:    "#1C1208", soft:     "#4A3520",
  muted:   "#8B7560", surface:"#FFFDF8", surface2: "#F7F2E8",
  border:  "#EDE4D0", green:  "#3D7A45", greenBg:  "#E8F5EA",
  red:     "#C0392B", redBg:  "#FDEEEC", blue:     "#2C6FAC",
};
const font = { jp: "'Noto Sans JP', sans-serif", num: "'DM Sans', sans-serif" };

/* ─────────────────────────────────────────────
   MOCK DATA
───────────────────────────────────────────── */
const INIT_LISTINGS = (() => {
  const pad = n => String(n).padStart(2,"0");
  const dateStr = (offsetDays, hour, min=0) => {
    const d = new Date(); d.setDate(d.getDate()+offsetDays);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(hour)}:${pad(min)}`;
  };
  return [
    { id:1, store:"マルエツ渋谷店",     dist:180, pack:10, size:"M",  price:298, time:dateStr(0,18),   confirmed:6, members:[{n:"山",c:"#1A5FA0",bg:"#DCEEFF",eggs:4,host:true},{n:"佐",c:"#A0401A",bg:"#FFE5DC",eggs:1},{n:"鈴",c:"#1A7A30",bg:"#E5FFE0",eggs:1}], lat:0.28, lng:0.22 },
    { id:2, store:"オーケー渋谷神南",   dist:340, pack:10, size:"L",  price:348, time:dateStr(1,12),   confirmed:9, members:[{n:"高",c:"#7A1AAF",bg:"#F5DCFF",eggs:3,host:true},{n:"中",c:"#A07A1A",bg:"#FFF5DC",eggs:2},{n:"伊",c:"#1A5FA0",bg:"#DCEEFF",eggs:2},{n:"木",c:"#A0401A",bg:"#FFE5DC",eggs:2}], lat:0.18, lng:0.58 },
    { id:3, store:"まいばすけっと代官山",dist:420, pack:6,  size:"M",  price:198, time:dateStr(0,20),   confirmed:0, members:[], lat:0.55, lng:0.66 },
    { id:4, store:"サミット渋谷桜丘",   dist:580, pack:10, size:"LL", price:320, time:dateStr(1,10),   confirmed:4, members:[{n:"田",c:"#1A5FA0",bg:"#DCEEFF",eggs:2,host:true},{n:"中",c:"#A07A1A",bg:"#FFF5DC",eggs:2}], lat:0.65, lng:0.35 },
  ];
})();

/* 日時文字列 "YYYY-MM-DDTHH:mm" → "05/25（日）18:00〜" */
const formatTime = (raw) => {
  if (!raw || !raw.includes("T")) return raw;
  const [d, t] = raw.split("T");
  const date = new Date(`${d}T${t}`);
  const dow = ["日","月","火","水","木","金","土"][date.getDay()];
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(d);
  const diff = Math.round((target - today) / 86400000);
  const prefix = diff === 0 ? "今日 " : diff === 1 ? "明日 " : "";
  return `${prefix}${d.slice(5).replace("-","/")}（${dow}）${t}〜`;
};

/* ─────────────────────────────────────────────
   SHARED MICRO COMPONENTS
───────────────────────────────────────────── */
const ProgressBar = ({ filled, total, style={} }) => {
  const pct = Math.min(100, (filled/total)*100);
  const color = pct >= 90 ? `linear-gradient(90deg,${C.yolk},${C.red})`
              : pct >= 60 ? `linear-gradient(90deg,${C.warm},${C.yolk})`
              :              `linear-gradient(90deg,${C.warm},${C.yolk})`;
  return (
    <div style={{ ...style }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.muted, marginBottom:3 }}>
        <span style={{ color: pct>=90 ? C.red : "inherit" }}>
          {pct>=90 ? `残り${total-filled}個！` : `残り${total-filled}個募集中`}
        </span>
        <span style={{ fontFamily:font.num }}>{filled}/{total}</span>
      </div>
      <div style={{ height:5, background:C.border, borderRadius:10, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", borderRadius:10, background:color, transition:"width 0.5s ease" }}/>
      </div>
    </div>
  );
};

const AvatarChip = ({ n, bg, c, size=20 }) => (
  <div style={{ width:size, height:size, borderRadius:"50%", background:bg, color:c, border:`1.5px solid ${C.surface}`,
    display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.42, fontWeight:700, fontFamily:font.jp, marginLeft:size==20?-3:0 }}>{n}</div>
);

const StoreTag = ({ name }) => (
  <span style={{ display:"inline-flex", alignItems:"center", gap:3, background:C.light, color:C.mid,
    fontSize:10, fontWeight:600, borderRadius:7, padding:"2px 7px", fontFamily:font.jp }}>🏪 {name}</span>
);

const BottomNav = ({ active, onNavigate, myBadge }) => {
  const items = [["🥚","フィード","feed"],["📋","管理","my"],["👤","マイページ","profile"]];
  return (
    <div style={{ display:"flex", justifyContent:"space-around", padding:"9px 0 14px",
      background:C.surface, borderTop:`1px solid ${C.border}`, flexShrink:0 }}>
      {items.map(([icon,label,key])=>(
        <div key={key} onClick={()=>onNavigate(key)} style={{ display:"flex", flexDirection:"column", alignItems:"center",
          gap:1, fontSize:9, color: active===key ? C.warm : C.muted, fontFamily:font.jp, cursor:"pointer",
          transition:"color 0.2s", fontWeight: active===key ? 700 : 400, position:"relative" }}>
          <div style={{ fontSize:18, position:"relative" }}>
            {icon}
            {key==="my" && myBadge > 0 && (
              <span style={{ position:"absolute", top:-2, right:-8, minWidth:14, height:14, padding:"0 3px",
                borderRadius:7, background:C.red, color:"#fff", fontSize:9, fontWeight:700,
                display:"flex", alignItems:"center", justifyContent:"center", border:"1.5px solid #fff" }}>{myBadge}</span>
            )}
          </div>
          {label}
        </div>
      ))}
    </div>
  );
};

const BackHeader = ({ title, onBack, right }) => (
  <div style={{ padding:"9px 14px", display:"flex", alignItems:"center", gap:9,
    borderBottom:`1px solid ${C.border}`, background:C.surface, flexShrink:0 }}>
    <button onClick={onBack} className="btn-press" style={{ width:28, height:28, borderRadius:"50%",
      background:C.surface2, border:"none", display:"flex", alignItems:"center", justifyContent:"center",
      fontSize:18, color:C.dark, cursor:"pointer" }}>‹</button>
    <div style={{ flex:1, fontSize:14, fontWeight:700, color:C.ink, fontFamily:font.jp }}>{title}</div>
    {right}
  </div>
);

/* Mock map road layer */
const MapRoads = () => (
  <>
    {[35,62].map(t=><div key={t} style={{ position:"absolute", top:`${t}%`, left:0, right:0, height:3, background:"rgba(255,255,255,0.65)" }}/>)}
    {[28,65].map(l=><div key={l} style={{ position:"absolute", left:`${l}%`, top:0, bottom:0, width:3, background:"rgba(255,255,255,0.65)" }}/>)}
    {/* building blocks */}
    {[[9,8,18,18],[9,72,18,17],[74,10,14,18],[74,70,14,16]].map(([l,t,w,h],i)=>(
      <div key={i} style={{ position:"absolute", left:`${l}%`, top:`${t}%`, width:`${w}%`, height:`${h}%`,
        background:"rgba(255,255,255,0.15)", borderRadius:3 }}/>
    ))}
  </>
);

/* ─────────────────────────────────────────────
   LISTING CARD
───────────────────────────────────────────── */
const ListingCard = ({ listing, onTap, delay=0 }) => {
  const perEgg = Math.ceil(listing.price / listing.pack);
  return (
    <div className="hover-card fade-up" onClick={()=>onTap(listing)} style={{ animationDelay:`${delay}s`,
      background:C.surface, borderRadius:14, border:`1px solid ${C.border}`, padding:11,
      boxShadow:"0 2px 10px rgba(120,80,0,0.07)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <StoreTag name={listing.store}/>
        <span style={{ fontSize:10, color:C.muted }}>🚶 {listing.dist}m</span>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:7 }}>
        <span style={{ fontSize:26, lineHeight:1 }}>🥚</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.ink, fontFamily:font.jp }}>{listing.pack}個入り {listing.size}サイズ</div>
          <div style={{ fontSize:10, color:C.muted }}>¥{listing.price} → 1個 約¥{perEgg}</div>
        </div>
        <div style={{ textAlign:"right", fontSize:10, color:C.mid, fontWeight:600, fontFamily:font.jp, lineHeight:1.5 }}>
          {formatTime(listing.time).split(" ")[0]}<br/>{formatTime(listing.time).split(" ").slice(1).join(" ")}
        </div>
      </div>
      <ProgressBar filled={listing.confirmed} total={listing.pack} style={{ marginTop:8 }}/>
      <div style={{ display:"flex", alignItems:"center", gap:2, marginTop:7 }}>
        {listing.members.map((m,i)=><AvatarChip key={i} {...m}/>)}
        {listing.members.length>0 && <span style={{ fontSize:10, color:C.muted, marginLeft:5 }}>{listing.members.length}人参加中</span>}
        {listing.members.length===0 && <span style={{ fontSize:10, color:C.mid, fontWeight:600 }}>最初の参加者になろう！</span>}
      </div>
      <button className="btn-press" style={{ marginTop:8, width:"100%", padding:"7px 0", background:C.warm, border:"none",
        borderRadius:9, color:"#fff", fontSize:12, fontWeight:600, fontFamily:font.jp, cursor:"pointer" }}>
        参加して個数を申請する →
      </button>
    </div>
  );
};

/* ─────────────────────────────────────────────
   SCREEN: ONBOARDING
───────────────────────────────────────────── */
const DEV_USERS = [
  { label:"山田さくら（主催者）", id:"" },   // seed の dev-yamada のUUIDを入れる
  { label:"佐藤たろう（参加済み）", id:"" }, // dev-sato
  { label:"鈴木はなこ（新規）",   id:"" },   // dev-suzuki
];

const OnboardScreen = ({ onStart }) => {
  const [picked, setPicked] = useState(null);
  return (
  <div style={{ display:"flex", flexDirection:"column", flex:1, background:C.surface, overflow:"hidden" }}>
    <div style={{ width:"100%", height:185, background:"linear-gradient(160deg,#FEF3DC,#FFE4A0)", flexShrink:0,
      display:"flex", alignItems:"center", justifyContent:"center", position:"relative", overflow:"hidden" }}>
      {[["top:14px;left:22px","🥚"],["top:20px;right:26px","🥚"],["bottom:12px;left:38px","🥚"],["bottom:16px;right:40px","🥚"]].map(([s,e],i)=>(
        <div key={i} style={{ position:"absolute", ...Object.fromEntries(s.split(";").map(x=>x.split(":"))), fontSize:20, opacity:0.25 }}>{e}</div>
      ))}
      <div style={{ fontSize:58, animation:"floatEgg 3s ease-in-out infinite", filter:"drop-shadow(0 4px 14px rgba(180,100,0,0.22))" }}>🥚</div>
    </div>
    <div style={{ padding:"16px 20px 0", flex:1, display:"flex", flexDirection:"column", overflowY:"auto" }}>
      <div className="fade-up" style={{ fontFamily:font.num, fontSize:28, fontWeight:700, color:C.dark, letterSpacing:-1, marginBottom:5 }}>
        たま<span style={{ color:C.warm }}>わり</span>
      </div>
      <div className="fade-up" style={{ animationDelay:".05s", fontSize:12, color:C.muted, lineHeight:1.8, marginBottom:14, fontFamily:font.jp }}>
        一人暮らしで10個も要らない？<br/>近所の人と集まって一緒に買おう
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
        {[["📍","近所のスーパーで買い出し募集"],["🗺️","Google Mapsでお店を簡単検索"],["🤝","現地で一緒に買ってその場で分ける"]].map(([icon,text],i)=>(
          <div key={i} className="fade-up" style={{ animationDelay:`${0.08+i*0.06}s`, display:"flex", alignItems:"center", gap:9,
            background:C.surface2, borderRadius:10, padding:"7px 11px", border:`1px solid ${C.border}` }}>
            <span style={{ fontSize:16 }}>{icon}</span>
            <span style={{ fontSize:12, color:C.ink, fontWeight:500, fontFamily:font.jp }}>{text}</span>
          </div>
        ))}
      </div>

      {/* API有効＆ユーザーID設定済みのとき：ログインユーザー選択 */}
      {USE_API && DEV_USERS.some(u => u.id) ? (
        <>
          <div style={{ fontSize:10, color:C.muted, fontWeight:600, marginBottom:6, fontFamily:font.jp }}>ログインするユーザーを選択（開発用）</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:12 }}>
            {DEV_USERS.filter(u=>u.id).map((u,i)=>(
              <button key={i} onClick={()=>setPicked(u.id)} className="btn-press"
                style={{ padding:"9px 12px", borderRadius:10, textAlign:"left", cursor:"pointer",
                  border: picked===u.id ? "none" : `1px solid ${C.border}`,
                  background: picked===u.id ? C.warm : C.surface,
                  color: picked===u.id ? "#fff" : C.ink,
                  fontSize:12, fontWeight:600, fontFamily:font.jp }}>
                {picked===u.id ? "✓ " : "👤 "}{u.label}
              </button>
            ))}
          </div>
          <button onClick={()=>{ setCurrentUser(picked); onStart(); }} disabled={!picked} className="btn-press"
            style={{ width:"100%", padding:11, border:"none", borderRadius:13, marginBottom:12,
              background: picked ? C.dark : "#ccc", color:"#fff", fontSize:14, fontWeight:700,
              fontFamily:font.jp, cursor: picked?"pointer":"default" }}>
            このユーザーで始める →
          </button>
        </>
      ) : (
        <>
          <button onClick={onStart} className="btn-press" style={{ width:"100%", padding:11, background:C.dark, border:"none",
            borderRadius:13, color:"#fff", fontSize:14, fontWeight:700, fontFamily:font.jp, cursor:"pointer", marginBottom:7 }}>
            電話番号で始める →
          </button>
          <div style={{ fontSize:10, color:C.muted, textAlign:"center", fontFamily:font.jp, marginBottom:12 }}>ログイン / 新規登録</div>
        </>
      )}
    </div>
  </div>
  );
};

/* ─────────────────────────────────────────────
   SCREEN: FEED (LIST + MAP)
───────────────────────────────────────────── */
const FeedScreen = ({ listings, loading, error, onRetry, onRefresh, locName, locating, onLocate, notifications = [], onSelect, onPost, onNavigate, unreadTotal }) => {
  const [view, setView] = useState("list");
  const [selectedMapId, setSelectedMapId] = useState(null);
  const [showFilter, setShowFilter] = useState(false);
  const [filters, setFilters] = useState({ size:"all", sort:"distance", availableOnly:false });
  const [keyword, setKeyword] = useState("");
  const [pulling, setPulling] = useState(false);  // プルダウン更新の状態
  const pullStart = useRef(0);

  // 検索 + 絞り込み + 並び替えを適用
  const filtered = listings
    .filter(l => keyword.trim() === "" || (l.store || "").includes(keyword.trim()))
    .filter(l => filters.size === "all" || l.size === filters.size)
    .filter(l => !filters.availableOnly || (l.pack - l.confirmed) > 0)
    .slice()
    .sort((a,b) => {
      if (filters.sort === "distance")  return (a.dist||0) - (b.dist||0);
      if (filters.sort === "time")      return new Date(a.time) - new Date(b.time);
      if (filters.sort === "remaining") return (b.pack-b.confirmed) - (a.pack-a.confirmed);
      return 0;
    });

  const filterActive = filters.size !== "all" || filters.availableOnly || filters.sort !== "distance";

  const selectedMarker = listings.find(l=>l.id===selectedMapId);

  const markerColor = (l) => {
    const pct = l.confirmed/l.pack;
    if(pct>=0.9) return C.red;
    if(pct>=0.5) return C.green;
    return C.dark;
  };

  // プルダウン更新（リスト先頭で下方向にドラッグ）
  const handleTouchStart = (e) => { pullStart.current = e.touches[0].clientY; };
  const handleTouchMove = (e) => {
    const el = e.currentTarget;
    if (el.scrollTop <= 0 && e.touches[0].clientY - pullStart.current > 70 && !pulling) {
      setPulling(true);
      Promise.resolve(onRefresh && onRefresh()).finally(() => setTimeout(() => setPulling(false), 600));
    }
  };

  const sizeLabels = { all:"すべて", M:"M", L:"L", LL:"LL" };
  const sortLabels = { distance:"近い順", time:"集合が早い順", remaining:"残り個数が多い順" };

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"9px 16px 10px", borderBottom:`1px solid ${C.border}`, background:C.surface, flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:font.num, fontSize:22, fontWeight:700, color:C.dark, letterSpacing:-0.5 }}>
              たま<span style={{ color:C.warm }}>わり</span>
            </div>
            <button onClick={onLocate} disabled={locating} className="btn-press"
              style={{ display:"flex", alignItems:"center", gap:3, marginTop:2, padding:0,
                background:"none", border:"none", cursor:"pointer", fontFamily:font.jp }}>
              {locating
                ? <span style={{ width:9, height:9, border:`2px solid ${C.border}`, borderTopColor:C.warm, borderRadius:"50%", animation:"spin 0.8s linear infinite", display:"inline-block" }}/>
                : "📍"}
              <span style={{ fontSize:10, color:C.mid, fontWeight:600, textDecoration:"underline" }}>
                {locating ? "取得中…" : `${locName || "渋谷区周辺"} ▾`}
              </span>
            </button>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={onRefresh} disabled={loading} className="btn-press"
              style={{ width:32, height:32, borderRadius:"50%", background:C.surface2,
                border:`1px solid ${C.border}`, cursor:"pointer", fontSize:14,
                display:"flex", alignItems:"center", justifyContent:"center",
                color:C.mid }}>
              <span style={{ display:"inline-block", animation: loading ? "spin 0.8s linear infinite" : "none" }}>↻</span>
            </button>
            <div style={{ width:32, height:32, borderRadius:"50%", background:C.light, color:C.dark,
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700,
              border:`1.5px solid ${C.border}`, fontFamily:font.jp }}>田</div>
          </div>
        </div>
        {/* 検索バー */}
        <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:9, background:C.surface2,
          borderRadius:10, padding:"6px 10px", border:`1px solid ${C.border}` }}>
          <span style={{ fontSize:13 }}>🔍</span>
          <input value={keyword} onChange={e=>setKeyword(e.target.value)}
            placeholder="店名で検索（例：マルエツ）"
            style={{ flex:1, border:"none", background:"transparent", fontSize:12, color:C.ink,
              outline:"none", fontFamily:font.jp, minWidth:0 }}/>
          {keyword && <span onClick={()=>setKeyword("")} style={{ cursor:"pointer", fontSize:14, color:C.muted }}>×</span>}
        </div>
        {/* Toggle */}
        <div style={{ display:"flex", gap:6, marginTop:9, alignItems:"center" }}>
          {[["list","☰ リスト"],["map","🗺 マップ"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} className="btn-press"
              style={{ flex:1, padding:"5px 0", borderRadius:9,
                border: view===v ? "none" : `1.5px solid ${C.border}`,
                background: view===v ? C.warm : "transparent",
                color: view===v ? "#fff" : C.muted,
                fontSize:11, fontWeight:700, fontFamily:font.jp, cursor:"pointer",
                transition:"all 0.2s" }}>{label}</button>
          ))}
          <button onClick={()=>setShowFilter(v=>!v)} className="btn-press"
            style={{ padding:"5px 10px", borderRadius:9,
              border: filterActive ? "none" : `1px solid ${C.border}`,
              background: filterActive ? C.dark : C.surface2,
              color: filterActive ? "#fff" : C.soft,
              fontSize:11, fontFamily:font.jp, cursor:"pointer", whiteSpace:"nowrap",
              transition:"all 0.2s" }}>
            絞り込み {showFilter ? "▴" : "▾"}{filterActive ? " ●" : ""}
          </button>
        </div>

        {/* Filter panel */}
        {showFilter && (
          <div className="fade-in" style={{ marginTop:9, padding:"10px 11px", background:C.surface2,
            borderRadius:11, border:`1px solid ${C.border}` }}>
            {/* サイズ */}
            <div style={{ fontSize:10, color:C.muted, fontWeight:600, marginBottom:5, fontFamily:font.jp }}>サイズ</div>
            <div style={{ display:"flex", gap:5, marginBottom:9 }}>
              {Object.entries(sizeLabels).map(([v,label])=>(
                <button key={v} onClick={()=>setFilters(f=>({ ...f, size:v }))} className="btn-press"
                  style={{ flex:1, padding:"5px 0", borderRadius:7,
                    border: filters.size===v ? "none" : `1px solid ${C.border}`,
                    background: filters.size===v ? C.warm : C.surface,
                    color: filters.size===v ? "#fff" : C.soft,
                    fontSize:11, fontWeight:600, fontFamily:font.jp, cursor:"pointer" }}>{label}</button>
              ))}
            </div>
            {/* 並び替え */}
            <div style={{ fontSize:10, color:C.muted, fontWeight:600, marginBottom:5, fontFamily:font.jp }}>並び替え</div>
            <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:9 }}>
              {Object.entries(sortLabels).map(([v,label])=>(
                <button key={v} onClick={()=>setFilters(f=>({ ...f, sort:v }))} className="btn-press"
                  style={{ padding:"6px 10px", borderRadius:7, textAlign:"left",
                    border: filters.sort===v ? "none" : `1px solid ${C.border}`,
                    background: filters.sort===v ? C.warm : C.surface,
                    color: filters.sort===v ? "#fff" : C.soft,
                    fontSize:11, fontWeight: filters.sort===v?700:500, fontFamily:font.jp, cursor:"pointer" }}>
                  {filters.sort===v ? "✓ " : ""}{label}
                </button>
              ))}
            </div>
            {/* 空きあり */}
            <button onClick={()=>setFilters(f=>({ ...f, availableOnly:!f.availableOnly }))} className="btn-press"
              style={{ width:"100%", padding:"7px 10px", borderRadius:7, display:"flex",
                alignItems:"center", justifyContent:"space-between",
                border:`1px solid ${C.border}`, background:C.surface, cursor:"pointer", fontFamily:font.jp }}>
              <span style={{ fontSize:11, color:C.ink, fontWeight:500 }}>空きがある募集のみ</span>
              <span style={{ width:34, height:18, borderRadius:20, position:"relative",
                background: filters.availableOnly ? C.green : C.border, transition:"background 0.2s" }}>
                <span style={{ position:"absolute", top:2, left: filters.availableOnly ? 18 : 2,
                  width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }}/>
              </span>
            </button>
            {filterActive && (
              <button onClick={()=>setFilters({ size:"all", sort:"distance", availableOnly:false })}
                style={{ width:"100%", marginTop:7, padding:"5px 0", background:"none",
                  border:"none", color:C.muted, fontSize:10, fontFamily:font.jp, cursor:"pointer", textDecoration:"underline" }}>
                絞り込みをリセット
              </button>
            )}
          </div>
        )}
      </div>

      {/* LIST VIEW */}
      {view==="list" && (
        <div className="fade-in" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove}
          style={{ flex:1, overflowY:"auto", background:C.surface2, padding:"9px 11px", display:"flex", flexDirection:"column", gap:7 }}>
          {/* プルダウン更新インジケーター */}
          {pulling && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"4px 0" }}>
              <div style={{ width:16, height:16, border:`2px solid ${C.border}`, borderTopColor:C.warm, borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
              <span style={{ fontSize:11, color:C.muted, fontFamily:font.jp }}>更新中…</span>
            </div>
          )}
          {/* ローディング */}
          {loading && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"60px 0", gap:12 }}>
              <div style={{ width:28, height:28, border:`3px solid ${C.border}`, borderTopColor:C.warm, borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
              <div style={{ fontSize:12, color:C.muted, fontFamily:font.jp }}>募集を探しています…</div>
            </div>
          )}

          {/* エラー */}
          {!loading && error && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"50px 24px", gap:12, textAlign:"center" }}>
              <div style={{ fontSize:36 }}>😢</div>
              <div style={{ fontSize:13, color:C.ink, fontWeight:500, fontFamily:font.jp }}>{error}</div>
              <button onClick={onRetry} className="btn-press"
                style={{ padding:"8px 20px", background:C.warm, border:"none", borderRadius:10,
                  color:"#fff", fontSize:12, fontWeight:700, fontFamily:font.jp, cursor:"pointer" }}>
                再試行
              </button>
            </div>
          )}

          {/* 空状態 */}
          {!loading && !error && listings.length===0 && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"50px 24px", gap:10, textAlign:"center" }}>
              <div style={{ fontSize:40, opacity:0.4 }}>🥚</div>
              <div style={{ fontSize:13, color:C.ink, fontWeight:500, fontFamily:font.jp }}>近くに募集がありません</div>
              <div style={{ fontSize:11, color:C.muted, lineHeight:1.7, fontFamily:font.jp }}>＋ボタンから最初の募集を投稿してみよう</div>
            </div>
          )}

          {/* 検索・絞り込み結果が0件 */}
          {!loading && !error && listings.length>0 && filtered.length===0 && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"50px 24px", gap:10, textAlign:"center" }}>
              <div style={{ fontSize:36, opacity:0.4 }}>🔍</div>
              <div style={{ fontSize:13, color:C.ink, fontWeight:500, fontFamily:font.jp }}>
                {keyword ? `「${keyword}」に一致する募集がありません` : "条件に合う募集がありません"}
              </div>
              <button onClick={()=>{ setFilters({ size:"all", sort:"distance", availableOnly:false }); setKeyword(""); }} className="btn-press"
                style={{ padding:"7px 18px", background:C.warm, border:"none", borderRadius:9,
                  color:"#fff", fontSize:12, fontWeight:700, fontFamily:font.jp, cursor:"pointer" }}>検索・絞り込みをリセット</button>
            </div>
          )}

          {/* 通知バナー */}
          {!loading && !error && notifications.length > 0 && notifications.map(n => (
            <div key={n.id} onClick={()=>onSelect(n.listing)} className="hover-card"
              style={{ background: n.icon==="⏰" ? "#FFF3E0" : C.greenBg,
                border:`1px solid ${n.icon==="⏰" ? "#F5C060" : "#A5D6A7"}`,
                borderRadius:10, padding:"8px 11px", display:"flex", alignItems:"center", gap:8,
                fontFamily:font.jp, cursor:"pointer" }}>
              <span style={{ fontSize:16 }}>{n.icon}</span>
              <span style={{ flex:1, fontSize:11, color:C.ink, fontWeight:500, lineHeight:1.5 }}>{n.text}</span>
              <span style={{ fontSize:13, color:C.warm, fontWeight:700 }}>›</span>
            </div>
          ))}

          {/* 一覧 */}
          {!loading && !error && filtered.length>0 && (
            <>
              <div style={{ background:C.light, border:`1px solid #F5C060`, borderRadius:9, padding:"6px 10px",
                fontSize:10, color:C.dark, display:"flex", alignItems:"center", gap:5, fontFamily:font.jp }}>
                {(filterActive || keyword) ? `🔍 ${filtered.length}件の募集` : `🔔 近くで新着！${filtered[0].store}`}
              </div>
              {filtered.map((l,i)=><ListingCard key={l.id} listing={l} onTap={onSelect} delay={i*0.05}/>)}
              <div style={{ height:12 }}/>
            </>
          )}
        </div>
      )}

      {/* MAP VIEW */}
      {view==="map" && (
        <div className="fade-in" style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Map */}
          <div style={{ flex:1, position:"relative", overflow:"hidden",
            background:"linear-gradient(160deg,#E8F5E9,#C8E6C9 50%,#A5D6A7)", minHeight:200 }}>
            <MapRoads/>
            {/* Current location */}
            <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)" }}>
              <div style={{ width:14, height:14, borderRadius:"50%", background:C.blue,
                border:"3px solid #fff", animation:"pulse 2s infinite",
                boxShadow:"0 0 0 5px rgba(44,111,172,0.2)" }}/>
            </div>
            {/* Markers */}
            {filtered.map(l=>(
              <div key={l.id} onClick={()=>setSelectedMapId(l.id===selectedMapId?null:l.id)}
                style={{ position:"absolute", top:`${l.lat*100}%`, left:`${l.lng*100}%`,
                  transform:"translate(-50%,-100%)", display:"flex", flexDirection:"column",
                  alignItems:"center", cursor:"pointer",
                  filter: selectedMapId===l.id ? "drop-shadow(0 3px 8px rgba(0,0,0,0.3))" : "none",
                  transition:"transform 0.2s", zIndex: selectedMapId===l.id ? 5:1 }}>
                <div style={{ background:markerColor(l), color:"#fff", borderRadius:"10px 10px 10px 0",
                  padding:"3px 7px", fontSize:9, fontWeight:700, fontFamily:font.jp,
                  boxShadow:"0 2px 6px rgba(0,0,0,0.22)", whiteSpace:"nowrap",
                  border: selectedMapId===l.id ? "2px solid #fff" : "none" }}>
                  {l.confirmed}/{l.pack} {l.pack-l.confirmed===0 ? "満員" : `残${l.pack-l.confirmed}個`}
                </div>
                <div style={{ fontSize:16, lineHeight:1 }}>🥚</div>
              </div>
            ))}
            {/* Controls */}
            <div style={{ position:"absolute", top:8, right:8, display:"flex", flexDirection:"column", gap:3 }}>
              {["＋","－","📍"].map((s,i)=>(
                <div key={i} style={{ width:28, height:28, borderRadius:8, background:"rgba(255,255,255,0.95)",
                  border:"1px solid rgba(0,0,0,0.1)", display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:i===2?14:16, fontWeight:600, cursor:"pointer", color:C.ink }}>{s}</div>
              ))}
            </div>
            <div style={{ position:"absolute", bottom:4, right:7, fontSize:7, color:"rgba(0,0,0,0.35)", fontFamily:font.num }}>Powered by Google</div>
            {/* Legend */}
            <div style={{ position:"absolute", bottom:6, left:8, display:"flex", gap:6, alignItems:"center" }}>
              {[[C.green,"余裕あり"],[C.dark,"募集中"],[C.red,"残りわずか"]].map(([c,l])=>(
                <div key={l} style={{ display:"flex", alignItems:"center", gap:3, background:"rgba(255,255,255,0.88)",
                  borderRadius:6, padding:"2px 5px", fontSize:8, fontFamily:font.jp, color:C.ink }}>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:c }}/>
                  {l}
                </div>
              ))}
            </div>
          </div>
          {/* Bottom sheet */}
          {selectedMarker ? (
            <div className="slide-up" style={{ background:C.surface, borderTop:`1px solid ${C.border}`, padding:"8px 12px 6px", flexShrink:0 }}>
              <div style={{ width:32, height:3, background:C.border, borderRadius:10, margin:"0 auto 8px" }}/>
              <div style={{ fontSize:11, fontWeight:700, color:C.ink, marginBottom:6, fontFamily:font.jp }}>📍 {selectedMarker.store}</div>
              <div className="hover-card" onClick={()=>onSelect(selectedMarker)}
                style={{ display:"flex", alignItems:"center", gap:8, background:C.light, borderRadius:10,
                  padding:"8px 10px", border:`1px solid #F5C060` }}>
                <span style={{ fontSize:24 }}>🥚</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:C.ink, fontFamily:font.jp }}>{selectedMarker.store}</div>
                  <div style={{ fontSize:10, color:C.muted, fontFamily:font.jp }}>{selectedMarker.confirmed}/{selectedMarker.pack}確定・{formatTime(selectedMarker.time)}集合</div>
                </div>
                <span style={{ fontSize:16, color:C.warm, fontWeight:700 }}>›</span>
              </div>
            </div>
          ) : (
            <div style={{ background:C.surface, borderTop:`1px solid ${C.border}`, padding:"8px 12px 6px", flexShrink:0 }}>
              <div style={{ width:32, height:3, background:C.border, borderRadius:10, margin:"0 auto 8px" }}/>
              <div style={{ fontSize:11, color:C.muted, textAlign:"center", fontFamily:font.jp }}>ピンをタップして募集を確認</div>
            </div>
          )}
        </div>
      )}

      {/* FAB */}
      <button onClick={onPost} className="btn-press" style={{ position:"absolute", bottom:72, right:14,
        width:46, height:46, borderRadius:"50%", background:C.dark, color:"#fff",
        border:"none", fontSize:24, fontWeight:300, display:"flex", alignItems:"center", justifyContent:"center",
        boxShadow:"0 4px 16px rgba(120,80,0,0.32)", cursor:"pointer", zIndex:10 }}>＋</button>
      <BottomNav active="feed" onNavigate={onNavigate} myBadge={unreadTotal}/>
    </div>
  );
};

/* ─────────────────────────────────────────────
   SCREEN: DETAIL
───────────────────────────────────────────── */
const DetailScreen = ({ listing, onBack, onJoin, onBlock }) => {
  const [eggs, setEggs] = useState(2);
  const perEgg = Math.ceil(listing.price / listing.pack);
  const remaining = listing.pack - listing.confirmed;
  const available = Math.min(remaining, 5);
  const meId = USE_API ? currentUserId : "me";

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }}>
      <BackHeader title="募集詳細" onBack={onBack}/>
      {/* Map */}
      <div style={{ width:"100%", height:105, background:"linear-gradient(145deg,#DFF0D8,#C5E1A5 50%,#A5D6A7)",
        position:"relative", overflow:"hidden", flexShrink:0 }}>
        <MapRoads/>
        <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-100%)", fontSize:26,
          filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.28))" }}>📍</div>
        <div style={{ position:"absolute", bottom:5, right:7, background:"rgba(255,255,255,0.93)",
          borderRadius:7, padding:"2px 7px", fontSize:9, fontWeight:700, color:C.dark, fontFamily:font.jp }}>🚶 徒歩{Math.round(listing.dist/80)}分</div>
        <div style={{ position:"absolute", bottom:5, left:7, background:C.warm, borderRadius:7,
          padding:"3px 7px", fontSize:9, fontWeight:700, color:"#fff", fontFamily:font.jp, cursor:"pointer" }}>Google マップで開く</div>
        <div style={{ position:"absolute", bottom:3, right:7, fontSize:7, color:"rgba(0,0,0,0.3)", fontFamily:font.num, bottom:0, right:5 }}>Powered by Google</div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"9px 11px", background:C.surface2, display:"flex", flexDirection:"column", gap:7 }}>
        {/* Info */}
        <div className="fade-up" style={{ background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, overflow:"hidden" }}>
          {[["スーパー",listing.store],["パック",`${listing.pack}個入り ${listing.size}サイズ`],
            ["価格",`¥${listing.price}（1個 約¥${perEgg}）`],
            ["集合日時",formatTime(listing.time)],
            ...(listing.comment ? [["コメント", listing.comment]] : []),
          ].map(([label,val],i,arr)=>(
            <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start",
              padding:"7px 12px", borderBottom: i < arr.length-1 ? `1px solid ${C.border}` : "none", fontSize:11 }}>
              <span style={{ color:C.muted, fontFamily:font.jp, flexShrink:0 }}>{label}</span>
              <span style={{ fontWeight:600, color: label==="集合日時" ? C.mid : C.ink, fontFamily:font.jp,
                textAlign:"right", marginLeft:8, wordBreak:"break-all" }}>{val}</span>
            </div>
          ))}
        </div>

        {/* Members */}
        <div className="fade-up" style={{ animationDelay:".05s", background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, overflow:"hidden" }}>
          <div style={{ padding:"6px 12px 5px", fontSize:10, fontWeight:700, color:C.muted, fontFamily:font.jp }}>
            参加メンバー {listing.members.length}/{listing.pack}人
          </div>
          {listing.members.map((m,i)=>{
            const isMe = USE_API ? (m.userId && m.userId === meId) : false;
            const canBlock = onBlock && m.userId && !isMe;
            return (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 12px",
              borderTop:`1px solid ${C.border}` }}>
              <AvatarChip {...m} size={28}/>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:11, fontWeight:600, color:C.ink, fontFamily:font.jp }}>
                  {(m.fullName || m.n + "さん")}{m.host?"（主催）":""}
                </div>
                <div style={{ fontSize:10, color:C.muted, fontFamily:font.jp }}>{m.eggs}個希望</div>
              </div>
              {m.host && <span style={{ fontSize:9, padding:"2px 6px", borderRadius:6, background:C.greenBg, color:C.green, fontWeight:600, fontFamily:font.jp }}>主催</span>}
              {canBlock && (
                <button onClick={()=>onBlock(m)} className="btn-press"
                  style={{ fontSize:9, padding:"3px 8px", borderRadius:6, border:`1px solid ${C.border}`,
                    background:C.surface, color:C.muted, fontFamily:font.jp, cursor:"pointer" }}>
                  ブロック
                </button>
              )}
            </div>
            );
          })}
          {listing.members.length===0 && (
            <div style={{ padding:"10px 12px", fontSize:11, color:C.muted, textAlign:"center", fontFamily:font.jp, borderTop:`1px solid ${C.border}` }}>
              まだ誰も参加していません。最初の参加者になろう！🥚
            </div>
          )}
        </div>

        {/* Selector */}
        <div className="fade-up" style={{ animationDelay:".1s", background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:7, fontFamily:font.jp }}>何個欲しい？（残り{remaining}個）</div>
          <div style={{ display:"flex", gap:5 }}>
            {Array.from({length:available},(_,i)=>i+1).map(n=>(
              <button key={n} onClick={()=>setEggs(n)} className="btn-press"
                style={{ width:38, height:32, borderRadius:8,
                  border: eggs===n ? "none" : `1px solid ${C.border}`,
                  background: eggs===n ? C.warm : C.surface2,
                  color: eggs===n ? "#fff" : C.ink,
                  fontSize:12, fontWeight:600, fontFamily:font.num, cursor:"pointer",
                  transition:"all 0.15s" }}>{n}</button>
            ))}
          </div>
          <div style={{ fontSize:10, color:C.muted, marginTop:6, fontFamily:font.jp }}>
            {eggs}個 → ¥{eggs*perEgg}（現地で割り勘）
          </div>
          <button onClick={()=>onJoin(listing, eggs)} className="btn-press"
            style={{ marginTop:8, width:"100%", padding:8, background:C.warm, border:"none",
              borderRadius:10, color:"#fff", fontSize:13, fontWeight:600, fontFamily:font.jp, cursor:"pointer" }}>
            {eggs}個で参加確定 🥚
          </button>
        </div>
        <div style={{ height:8 }}/>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   SCREEN: POST
───────────────────────────────────────────── */
const PostScreen = ({ onBack, onSubmit }) => {
  const [store, setStore] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedStore, setSelectedStore] = useState(null);
  const [pack, setPack] = useState(10);
  const [size, setSize] = useState("M");
  const [price, setPrice] = useState("");
  const [myEggs, setMyEggs] = useState(2);
  const [meetTime, setMeetTime] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const suggestions = [
    { name:"マルエツ渋谷店",     sub:"東京都渋谷区宇田川町… · 徒歩3分" },
    { name:"マルエツ代官山店",   sub:"東京都渋谷区代官山町… · 徒歩8分" },
    { name:"マルエツ中目黒店",   sub:"東京都目黒区上目黒… · 徒歩12分" },
    { name:"オーケー渋谷神南店", sub:"東京都渋谷区神南… · 徒歩5分" },
    { name:"まいばすけっと代官山",sub:"東京都渋谷区代官山… · 徒歩6分" },
    { name:"サミット渋谷桜丘店", sub:"東京都渋谷区桜丘町… · 徒歩9分" },
  ].filter(s => store.length > 0 && s.name.includes(store));

  // 場所はサジェスト選択 or 自由入力どちらでも有効
  const storeValid    = selectedStore !== null || store.trim().length > 0;
  const priceValid    = price.trim().length > 0 && parseInt(price) > 0;
  const meetTimeValid = meetTime.trim().length > 0;

  // 必要項目チェック（pack・size・myEggsはデフォルト値あり）
  const valid = storeValid && priceValid && meetTimeValid;

  // 未入力フィールドをハイライト表示するため
  const [touched, setTouched] = useState({ store:false, price:false, meetTime:false });
  const touch = (field) => setTouched(prev => ({ ...prev, [field]:true }));

  const handleSubmit = () => {
    setTouched({ store:true, price:true, meetTime:true });
    if (!valid) return;
    setSubmitting(true);
    const storeName = selectedStore ? selectedStore.name : store.trim();
    setTimeout(() => {
      onSubmit({ store:storeName, pack, size, price:parseInt(price), myEggs, time:meetTime, comment:comment.trim() });
    }, 800);
  };

  const errBorder = (ok) => `1px solid ${ok ? C.border : C.red}`;
  const errMsg = (msg) => (
    <div style={{ fontSize:10, color:C.red, marginTop:4, fontFamily:font.jp }}>⚠ {msg}</div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }}>
      <BackHeader title="買い出し募集を投稿" onBack={onBack}/>
      <div style={{ flex:1, overflowY:"auto", padding:"10px 12px", background:C.surface2, display:"flex", flexDirection:"column", gap:7 }}>

        {/* Store search */}
        <div className="fade-up" style={{ background:C.surface, borderRadius:13,
          border: touched.store && !storeValid ? `1px solid ${C.red}` : `1px solid ${C.border}`,
          padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:6, fontWeight:600, fontFamily:font.jp }}>
            🔍 場所（スーパー名）<span style={{ color:C.red }}>*</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, background:C.surface2, borderRadius:9,
            padding:"6px 10px", border:`1px solid ${C.border}` }}>
            <span style={{ fontSize:14 }}>📍</span>
            <input value={store}
              onChange={e=>{ setStore(e.target.value); setShowSuggestions(true); setSelectedStore(null); }}
              onBlur={()=>touch("store")}
              placeholder="例：マルエツ渋谷店"
              style={{ border:"none", background:"transparent", fontSize:12, color:C.ink, outline:"none",
                fontFamily:font.jp, flex:1, minWidth:0 }}/>
            {store && <span onClick={()=>{ setStore(""); setSelectedStore(null); }} style={{ cursor:"pointer", fontSize:14, color:C.muted }}>×</span>}
          </div>
          {suggestions.length>0 && showSuggestions && (
            <div style={{ borderRadius:9, border:`1px solid ${C.border}`, overflow:"hidden", marginTop:5 }}>
              {suggestions.map((s,i)=>(
                <div key={i} onClick={()=>{ setSelectedStore(s); setStore(s.name); setShowSuggestions(false); }}
                  className="hover-card"
                  style={{ padding:"7px 10px", fontSize:11, display:"flex", alignItems:"center", gap:6,
                    borderBottom:i<suggestions.length-1?`1px solid ${C.border}`:"none",
                    background:C.surface, fontFamily:font.jp }}>
                  <span style={{ fontSize:14 }}>🏪</span>
                  <div><div style={{ color:C.ink }}>{s.name}</div><div style={{ fontSize:9, color:C.muted }}>{s.sub}</div></div>
                </div>
              ))}
            </div>
          )}
          {selectedStore
            ? <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:6, color:C.green, fontSize:10, fontWeight:600, fontFamily:font.jp }}>✓ {selectedStore.name} を選択しました</div>
            : store.trim().length > 0
              ? <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:6, color:C.mid, fontSize:10, fontFamily:font.jp }}>📝 「{store}」で登録します</div>
              : touched.store ? errMsg("場所を入力してください") : null
          }
        </div>

        {/* Map preview */}
        {selectedStore && (
          <div className="fade-up" style={{ background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, padding:"10px 12px" }}>
            <div style={{ fontSize:10, color:C.muted, marginBottom:6, fontWeight:600, fontFamily:font.jp }}>📌 選択したお店の場所</div>
            <div style={{ width:"100%", height:58, borderRadius:9, overflow:"hidden", position:"relative",
              background:"linear-gradient(135deg,#DFF0D8,#B2DFDB)", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ position:"absolute", top:"40%", left:0, right:0, height:2, background:"rgba(255,255,255,0.5)" }}/>
              <div style={{ position:"absolute", left:"45%", top:0, bottom:0, width:2, background:"rgba(255,255,255,0.5)" }}/>
              <span style={{ position:"relative", fontSize:20, zIndex:1 }}>📍</span>
              <div style={{ position:"absolute", bottom:3, right:5, fontSize:7, color:"rgba(0,0,0,0.35)", fontFamily:font.num }}>Powered by Google</div>
            </div>
          </div>
        )}

        {/* Pack size */}
        <div className="fade-up" style={{ animationDelay:".04s", background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:7, fontWeight:600, fontFamily:font.jp }}>何個入りを買いますか？</div>
          <div style={{ display:"flex", gap:5 }}>
            {[6,10,12].map(n=>(
              <button key={n} onClick={()=>setPack(n)} className="btn-press"
                style={{ flex:1, padding:"6px 0", borderRadius:8,
                  border:pack===n?"none":`1px solid ${C.border}`,
                  background:pack===n?C.warm:C.surface2,
                  color:pack===n?"#fff":C.soft,
                  fontSize:12, fontWeight:600, fontFamily:font.jp, cursor:"pointer", transition:"all 0.15s" }}>
                {n}個入り
              </button>
            ))}
          </div>
        </div>

        {/* Price, size, my eggs */}
        <div className="fade-up" style={{ animationDelay:".06s", background:C.surface, borderRadius:13,
          border: touched.price && !priceValid ? `1px solid ${C.red}` : `1px solid ${C.border}`,
          padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:7, fontWeight:600, fontFamily:font.jp }}>
            価格 · サイズ · 自分の希望個数
          </div>
          <div style={{ display:"flex", gap:6, alignItems:"stretch" }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:9, color:C.muted, marginBottom:3, fontFamily:font.jp }}>
                価格（¥）<span style={{ color:C.red }}>*</span>
              </div>
              <input value={price}
                onChange={e=>setPrice(e.target.value.replace(/[^0-9]/g,""))}
                onBlur={()=>touch("price")}
                placeholder="298" type="number" inputMode="numeric" min="0"
                style={{ width:"100%", padding:"6px 8px", background:C.surface2, borderRadius:8,
                  border: touched.price && !priceValid ? `1px solid ${C.red}` : `1px solid ${C.border}`,
                  fontSize:13, fontFamily:font.num, color:C.ink, outline:"none",
                  WebkitAppearance:"none", MozAppearance:"textfield" }}/>
              {touched.price && !priceValid && errMsg("価格を入力してください")}
            </div>
            <div>
              <div style={{ fontSize:9, color:C.muted, marginBottom:3, fontFamily:font.jp }}>サイズ<span style={{ color:C.red }}>*</span></div>
              <div style={{ display:"flex", gap:4 }}>
                {["M","L","LL"].map(s=>(
                  <button key={s} onClick={()=>setSize(s)} className="btn-press"
                    style={{ padding:"6px 8px", borderRadius:8,
                      border:size===s?"none":`1px solid ${C.border}`,
                      background:size===s?C.warm:C.surface2,
                      color:size===s?"#fff":C.soft, fontSize:11, fontWeight:600,
                      fontFamily:font.jp, cursor:"pointer", transition:"all 0.15s" }}>{s}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop:8 }}>
            <div style={{ fontSize:9, color:C.muted, marginBottom:5, fontFamily:font.jp }}>自分の希望個数<span style={{ color:C.red }}>*</span></div>
            <div style={{ display:"flex", gap:5 }}>
              {Array.from({length:Math.min(pack,6)},(_,i)=>i+1).map(n=>(
                <button key={n} onClick={()=>setMyEggs(n)} className="btn-press"
                  style={{ width:36, height:30, borderRadius:8,
                    border:myEggs===n?"none":`1px solid ${C.border}`,
                    background:myEggs===n?C.warm:C.surface2,
                    color:myEggs===n?"#fff":C.ink, fontSize:12, fontWeight:600,
                    fontFamily:font.num, cursor:"pointer", transition:"all 0.15s" }}>{n}</button>
              ))}
            </div>
          </div>
          {price && <div style={{ marginTop:6, fontSize:10, color:C.mid, fontFamily:font.jp }}>
            1個あたり ¥{Math.ceil(parseInt(price||0)/pack)} · あなたの分 ¥{myEggs*Math.ceil(parseInt(price||0)/pack)}
          </div>}
        </div>

        {/* Meet time */}
        <div className="fade-up" style={{ animationDelay:".08s", background:C.surface, borderRadius:13,
          border: touched.meetTime && !meetTimeValid ? `1px solid ${C.red}` : `1px solid ${C.border}`,
          padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:6, fontWeight:600, fontFamily:font.jp }}>
            🕕 集合日時<span style={{ color:C.red }}>*</span>
          </div>
          <div style={{ display:"flex", gap:6 }}>
            <input
              type="date"
              value={meetTime.split("T")[0] || ""}
              onChange={e => {
                const d = e.target.value;
                const t = meetTime.split("T")[1] || "18:00";
                setMeetTime(d ? `${d}T${t}` : "");
              }}
              onBlur={()=>touch("meetTime")}
              style={{ flex:1, padding:"7px 9px", background:C.surface2, borderRadius:9,
                border: touched.meetTime && !meetTimeValid ? `1px solid ${C.red}` : `1px solid ${C.border}`,
                fontSize:12, fontFamily:font.jp, color:C.ink, outline:"none" }}/>
            <input
              type="time"
              value={meetTime.split("T")[1] || "18:00"}
              onChange={e => {
                const d = meetTime.split("T")[0] || "";
                setMeetTime(d ? `${d}T${e.target.value}` : "");
              }}
              onBlur={()=>touch("meetTime")}
              style={{ width:88, padding:"7px 9px", background:C.surface2, borderRadius:9,
                border: touched.meetTime && !meetTimeValid ? `1px solid ${C.red}` : `1px solid ${C.border}`,
                fontSize:12, fontFamily:font.jp, color:C.ink, outline:"none" }}/>
          </div>
          {meetTime && (() => {
            const [d, t] = meetTime.split("T");
            if (!d) return null;
            const date = new Date(`${d}T${t||"00:00"}`);
            const today = new Date(); today.setHours(0,0,0,0);
            const target = new Date(d);
            const diff = Math.round((target - today) / 86400000);
            const label = diff === 0 ? "今日" : diff === 1 ? "明日" : diff === 2 ? "明後日" : `${diff}日後`;
            const dow = ["日","月","火","水","木","金","土"][date.getDay()];
            return (
              <div style={{ marginTop:5, fontSize:10, color:C.green, fontWeight:600, fontFamily:font.jp }}>
                ✓ {label}（{d.slice(5).replace("-","/")} {dow}曜）{t ? ` ${t}〜` : ""}
              </div>
            );
          })()}
          {touched.meetTime && !meetTimeValid && errMsg("集合日時を選択してください")}
        </div>

        {/* Comment (optional) */}
        <div className="fade-up" style={{ animationDelay:".09s", background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:6, fontWeight:600, fontFamily:font.jp }}>
            💬 コメント <span style={{ fontWeight:400, color:C.muted }}>(任意)</span>
          </div>
          <textarea
            value={comment} onChange={e => setComment(e.target.value)}
            placeholder="例：駐車場前に集合しましょう！卵以外も買う予定です"
            maxLength={100}
            rows={2}
            style={{ width:"100%", padding:"7px 10px", background:C.surface2, borderRadius:9,
              border:`1px solid ${C.border}`, fontSize:12, fontFamily:font.jp, color:C.ink,
              outline:"none", resize:"none", lineHeight:1.6 }}/>
          <div style={{ textAlign:"right", fontSize:9, color:C.muted, marginTop:3 }}>{comment.length}/100</div>
        </div>


        {Object.values(touched).some(Boolean) && !valid && (
          <div style={{ background:C.redBg, border:`1px solid ${C.red}`, borderRadius:10,
            padding:"8px 12px", fontSize:11, color:C.red, fontFamily:font.jp }}>
            ⚠ 未入力の必須項目（<span style={{ color:C.red }}>*</span>）があります
          </div>
        )}

        <div style={{ height:4 }}/>
      </div>

      <button onClick={handleSubmit} disabled={submitting} className="btn-press"
        style={{ margin:"0 12px 14px", padding:12,
          background: submitting ? "#ccc" : valid ? C.dark : C.mid,
          border:"none", borderRadius:13, color:"#fff", fontSize:14, fontWeight:700,
          fontFamily:font.jp, cursor: submitting ? "default" : "pointer",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8,
          transition:"background 0.2s", opacity: submitting ? 0.7 : 1 }}>
        {submitting
          ? <><div style={{ width:16, height:16, border:"2px solid rgba(255,255,255,0.4)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/> 投稿中…</>
          : "近くに募集を公開する 🥚"
        }
      </button>
    </div>
  );
};

/* ─────────────────────────────────────────────
   SCREEN: CONFIRMED
───────────────────────────────────────────── */
const ConfirmedScreen = ({ listing, eggs, onBack, onChat }) => {
  const perEgg = Math.ceil(listing.price / listing.pack);
  const myPay = eggs * perEgg;

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }}>
      <BackHeader title="参加確定 🎉" onBack={onBack}/>
      <div style={{ flex:1, overflowY:"auto", padding:"16px 14px", background:C.surface,
        display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
        <div className="pop-in" style={{ fontSize:60, lineHeight:1 }}>🥚</div>
        <div className="fade-up" style={{ fontFamily:font.num, fontSize:22, fontWeight:700, color:C.dark }}>参加完了！</div>
        {/* Meet info */}
        <div className="fade-up slide-up" style={{ animationDelay:".1s", background:C.light, border:`1px solid #F5C060`,
          borderRadius:14, padding:"12px 14px", width:"100%" }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.dark, marginBottom:9, fontFamily:font.jp }}>🗓 集合情報</div>
          {[["🏪", listing.store+"（入口に集合）"],["🕕", `${formatTime(listing.time)}（10分前からOK）`],["🥚", `あなたの担当：${eggs}個分（¥${myPay}）`]].map(([icon,text],i)=>(
            <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:7,
              fontSize:12, color:C.ink, marginBottom:i<2?7:0, fontFamily:font.jp }}>
              <span style={{ fontSize:15, flexShrink:0 }}>{icon}</span>
              <span style={{ lineHeight:1.5 }}>{text}</span>
            </div>
          ))}
        </div>

        {/* Members */}
        <div className="fade-up" style={{ animationDelay:".15s", width:"100%" }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.ink, marginBottom:8, fontFamily:font.jp }}>
            参加メンバー（{listing.members.length+1}人）
          </div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {listing.members.map((m,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:4, background:C.surface2,
                border:`1px solid ${C.border}`, borderRadius:20, padding:"3px 9px",
                fontSize:10, color:C.ink, fontFamily:font.jp }}>
                <div style={{ width:7, height:7, borderRadius:"50%", background:m.bg, border:`1px solid ${m.c}` }}/>
                {m.n}さん{m.host?"（主催）":""}
              </div>
            ))}
            <div style={{ display:"flex", alignItems:"center", gap:4, background:C.light,
              border:`1px solid #F5C060`, borderRadius:20, padding:"3px 9px",
              fontSize:10, color:C.dark, fontFamily:font.jp, fontWeight:600 }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:C.warm }}/>
              あなた
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="fade-up" style={{ animationDelay:".2s", width:"100%", display:"flex", flexDirection:"column", gap:7 }}>
          <button onClick={()=>onChat && onChat(listing)} className="btn-press"
            style={{ width:"100%", padding:11, background:C.dark, border:"none",
              borderRadius:12, color:"#fff", fontSize:13, fontWeight:700, fontFamily:font.jp, cursor:"pointer" }}>
            💬 メンバーとチャットする
          </button>
          <button className="btn-press"
            style={{ width:"100%", padding:11, background:C.green, border:"none",
              borderRadius:12, color:"#fff", fontSize:13, fontWeight:700, fontFamily:font.jp, cursor:"pointer" }}>
            📍 Google マップで道順を確認
          </button>
          <button onClick={onBack} className="btn-press"
            style={{ width:"100%", padding:10, background:"transparent", border:`1.5px solid ${C.border}`,
              borderRadius:12, color:C.muted, fontSize:12, fontWeight:600, fontFamily:font.jp, cursor:"pointer" }}>
            閉じる
          </button>
        </div>
        <div style={{ height:8 }}/>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   SCREEN: BLOCKS（ブロック管理）
───────────────────────────────────────────── */
const BlocksScreen = ({ onBack, showToast }) => {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(USE_API);

  useEffect(() => {
    if (!USE_API) { setLoading(false); return; }
    let active = true;
    api.getBlocks()
      .then(rows => { if (active) setBlocks(rows || []); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const handleUnblock = async (b) => {
    if (USE_API) {
      try {
        await api.unblockUser(b.blocked_id);
        setBlocks(prev => prev.filter(x => x.blocked_id !== b.blocked_id));
        showToast && showToast("ブロックを解除しました", "success");
      } catch (e) { showToast && showToast(e.message || "解除に失敗しました", "error"); }
      return;
    }
    setBlocks(prev => prev.filter(x => x.blocked_id !== b.blocked_id));
    showToast && showToast("ブロックを解除しました", "success");
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }}>
      <BackHeader title="🚫 ブロックしたユーザー" onBack={onBack}/>
      <div style={{ flex:1, overflowY:"auto", background:C.surface2, padding:"12px 12px", display:"flex", flexDirection:"column", gap:8 }}>
        {loading && (
          <div style={{ textAlign:"center", padding:"40px 0", fontSize:12, color:C.muted, fontFamily:font.jp }}>読み込み中…</div>
        )}
        {!loading && blocks.length === 0 && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            gap:10, padding:"48px 24px", color:C.muted, fontFamily:font.jp, textAlign:"center" }}>
            <div style={{ fontSize:36, opacity:0.4 }}>🚫</div>
            <div style={{ fontSize:13, fontWeight:500 }}>ブロックしているユーザーはいません</div>
            <div style={{ fontSize:11, lineHeight:1.7 }}>募集の参加メンバーから<br/>ブロックすると、その人の募集が表示されなくなります</div>
          </div>
        )}
        {blocks.map(b => (
          <div key={b.blocked_id} style={{ display:"flex", alignItems:"center", gap:10,
            background:C.surface, borderRadius:12, border:`1px solid ${C.border}`, padding:"10px 12px" }}>
            <div style={{ width:34, height:34, borderRadius:"50%", background:C.surface2,
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:700,
              color:C.muted, fontFamily:font.jp }}>{(b.blocked_nickname||"?").slice(0,1)}</div>
            <div style={{ flex:1, fontSize:13, fontWeight:600, color:C.ink, fontFamily:font.jp }}>
              {b.blocked_nickname || "ユーザー"}
            </div>
            <button onClick={()=>handleUnblock(b)} className="btn-press"
              style={{ padding:"6px 12px", borderRadius:8, border:`1px solid ${C.border}`,
                background:C.surface, color:C.mid, fontSize:11, fontWeight:600, fontFamily:font.jp, cursor:"pointer" }}>
              解除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   SCREEN: PROFILE（マイページ）
───────────────────────────────────────────── */
const ProfileScreen = ({ joinedListings, postedListings, onNavigate, onManageBlocks, unreadTotal }) => {
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState("田中 さくら");
  const [nameInput, setNameInput] = useState("田中 さくら");
  const [area, setArea] = useState("渋谷区・代官山エリア");

  const stats = [
    { label:"参加した購入", value: joinedListings.length, unit:"回" },
    { label:"主催した募集",  value: postedListings.length, unit:"回" },
    { label:"評価スコア",    value:"4.9", unit:"⭐" },
    { label:"節約した金額",  value:`¥${(joinedListings.length * 210).toLocaleString()}`, unit:"" },
  ];

  const menuSections = [
    { title:"アカウント", items:[
      { icon:"📍", label:"活動エリア", value:area },
      { icon:"🔔", label:"通知設定" },
      { icon:"🚫", label:"ブロックしたユーザー", action: onManageBlocks },
      { icon:"🔒", label:"プライバシー設定" },
    ]},
    { title:"サポート", items:[
      { icon:"❓", label:"使い方ガイド" },
      { icon:"📝", label:"利用規約" },
      { icon:"🛡️", label:"プライバシーポリシー" },
      { icon:"📮", label:"お問い合わせ" },
    ]},
    { title:"その他", items:[
      { icon:"⭐", label:"アプリを評価する" },
      { icon:"🚪", label:"ログアウト", danger:true },
    ]},
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"10px 16px 12px", borderBottom:`1px solid ${C.border}`, background:C.surface, flexShrink:0 }}>
        <div style={{ fontFamily:font.num, fontSize:20, fontWeight:700, color:C.dark, letterSpacing:-0.5 }}>👤 マイページ</div>
      </div>

      <div style={{ flex:1, overflowY:"auto", background:C.surface2 }}>

        {/* Profile card */}
        <div className="fade-up" style={{ background:C.surface, margin:"12px 12px 0", borderRadius:16,
          border:`1px solid ${C.border}`, padding:"14px 14px 12px",
          boxShadow:"0 2px 10px rgba(120,80,0,0.07)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {/* Avatar */}
            <div style={{ width:54, height:54, borderRadius:"50%", background:`linear-gradient(135deg,${C.warm},${C.yolk})`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:22, fontWeight:700, color:"#fff", flexShrink:0,
              boxShadow:`0 4px 12px rgba(230,140,0,0.3)` }}>
              {name.slice(0,1)}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              {editName ? (
                <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                  <input value={nameInput} onChange={e=>setNameInput(e.target.value)}
                    style={{ flex:1, padding:"4px 8px", borderRadius:7, border:`1px solid ${C.border}`,
                      fontSize:13, fontFamily:font.jp, color:C.ink, outline:"none", background:C.surface2 }}/>
                  <button onClick={()=>{ setName(nameInput); setEditName(false); }} className="btn-press"
                    style={{ padding:"4px 9px", borderRadius:7, background:C.warm, border:"none",
                      color:"#fff", fontSize:11, fontWeight:700, fontFamily:font.jp, cursor:"pointer" }}>保存</button>
                  <button onClick={()=>{ setNameInput(name); setEditName(false); }} className="btn-press"
                    style={{ padding:"4px 8px", borderRadius:7, background:C.surface2, border:`1px solid ${C.border}`,
                      color:C.muted, fontSize:11, fontFamily:font.jp, cursor:"pointer" }}>×</button>
                </div>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ fontSize:15, fontWeight:700, color:C.ink, fontFamily:font.jp }}>{name}</div>
                  <button onClick={()=>setEditName(true)} className="btn-press"
                    style={{ fontSize:10, color:C.muted, background:"none", border:"none", cursor:"pointer", padding:"2px 4px" }}>✏️</button>
                </div>
              )}
              <div style={{ fontSize:10, color:C.muted, marginTop:2, fontFamily:font.jp }}>📍 {area}</div>
              <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:4 }}>
                <span style={{ fontSize:10, background:C.greenBg, color:C.green, borderRadius:6,
                  padding:"1px 7px", fontWeight:600, fontFamily:font.jp }}>✓ 認証済み</span>
                <span style={{ fontSize:10, background:C.light, color:C.mid, borderRadius:6,
                  padding:"1px 7px", fontWeight:600, fontFamily:font.jp }}>⭐ 4.9</span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="fade-up" style={{ animationDelay:".04s", display:"grid", gridTemplateColumns:"1fr 1fr",
          gap:8, margin:"10px 12px 0" }}>
          {stats.map((s,i)=>(
            <div key={i} style={{ background:C.surface, borderRadius:12, border:`1px solid ${C.border}`,
              padding:"10px 12px", textAlign:"center" }}>
              <div style={{ fontFamily:font.num, fontSize:20, fontWeight:700, color:C.dark }}>
                {s.value}<span style={{ fontSize:11, marginLeft:2 }}>{s.unit}</span>
              </div>
              <div style={{ fontSize:10, color:C.muted, marginTop:2, fontFamily:font.jp }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Menu sections */}
        {menuSections.map((section, si)=>(
          <div key={si} className="fade-up" style={{ animationDelay:`${0.06+si*0.04}s`, margin:"10px 12px 0" }}>
            <div style={{ fontSize:10, fontWeight:700, color:C.muted, marginBottom:5,
              paddingLeft:2, fontFamily:font.jp, letterSpacing:0.5 }}>{section.title}</div>
            <div style={{ background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, overflow:"hidden" }}>
              {section.items.map((item, ii)=>(
                <div key={ii} className="hover-card" onClick={item.action || undefined}
                  style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px",
                    cursor: item.action ? "pointer" : "default",
                    borderBottom: ii < section.items.length-1 ? `1px solid ${C.border}` : "none" }}>
                  <span style={{ fontSize:15, width:20, textAlign:"center" }}>{item.icon}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:500, color: item.danger ? C.red : C.ink, fontFamily:font.jp }}>{item.label}</div>
                    {item.value && <div style={{ fontSize:10, color:C.muted, marginTop:1, fontFamily:font.jp }}>{item.value}</div>}
                  </div>
                  {!item.danger && <span style={{ fontSize:12, color:C.muted }}>›</span>}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{ height:20 }}/>
      </div>

      <BottomNav active="profile" onNavigate={onNavigate} myBadge={unreadTotal}/>
    </div>
  );
};

/* ─────────────────────────────────────────────
   SCREEN: CHAT（参加者チャット）
───────────────────────────────────────────── */
// モック用の初期メッセージ
const MOCK_MESSAGES = {
  default: [
    { id:"m1", user_id:"u-yamada", user_nickname:"山田さくら", body:"こんにちは！今日はよろしくお願いします🥚", created_at:new Date(Date.now()-3600000).toISOString() },
    { id:"m2", user_id:"u-sato",   user_nickname:"佐藤たろう", body:"よろしくお願いします！18時に入口でいいですか？", created_at:new Date(Date.now()-3000000).toISOString() },
    { id:"m3", user_id:"u-yamada", user_nickname:"山田さくら", body:"はい、入口の自動ドア前で待ってます🚪", created_at:new Date(Date.now()-2400000).toISOString() },
  ],
};

const ChatScreen = ({ listing, onBack, onLatest }) => {
  const [messages, setMessages] = useState(USE_API ? [] : (MOCK_MESSAGES.default));
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(USE_API);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const lastAtRef = useRef(null);

  const myId = USE_API ? currentUserId : "me";

  // 最新メッセージ時刻を親に報告（未読バッジ用）
  useEffect(() => {
    if (messages.length && onLatest) {
      const last = messages[messages.length - 1];
      onLatest(listing.id, new Date(last.created_at).getTime());
    }
  }, [messages, listing.id, onLatest]);

  // 最下部へスクロール
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  };

  // 初回読み込み＋ポーリング（API時のみ）
  useEffect(() => {
    if (!USE_API) { scrollToBottom(); return; }
    let active = true;

    const load = async (isPoll) => {
      try {
        const after = isPoll ? lastAtRef.current : null;
        const rows = await api.getMessages(listing.id, after);
        if (!active) return;
        if (rows && rows.length) {
          setMessages(prev => {
            const ids = new Set(prev.map(m => m.id));
            const merged = [...prev, ...rows.filter(r => !ids.has(r.id))];
            return merged;
          });
          lastAtRef.current = rows[rows.length-1].created_at;
          scrollToBottom();
        }
      } catch (e) { /* 取得失敗は黙って継続 */ }
      finally { if (!isPoll) setLoading(false); }
    };

    load(false);
    const timer = setInterval(() => load(true), 4000);  // 4秒ごとに新着取得
    return () => { active = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");

    if (USE_API) {
      setSending(true);
      try {
        const msg = await api.sendMessage(listing.id, text);
        setMessages(prev => [...prev, msg]);
        lastAtRef.current = msg.created_at;
        scrollToBottom();
      } catch (e) {
        setInput(text); // 失敗時は入力を戻す
      } finally { setSending(false); }
      return;
    }
    // モック
    const msg = { id:`m${Date.now()}`, user_id:"me", user_nickname:"あなた", body:text, created_at:new Date().toISOString() };
    setMessages(prev => [...prev, msg]);
    scrollToBottom();
  };

  const timeStr = (iso) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };

  // 送信者ごとの色
  const colorFor = (uid) => {
    const palette = ["#1A5FA0","#A0401A","#1A7A30","#7A1AAF","#A07A1A"];
    let h = 0; for (const ch of (uid||"")) h = (h*31 + ch.charCodeAt(0)) % palette.length;
    return palette[h];
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }}>
      <BackHeader title={`💬 ${listing.store}`} onBack={onBack}/>
      <div style={{ padding:"5px 14px", background:C.light, borderBottom:`1px solid ${C.border}`,
        fontSize:10, color:C.mid, fontFamily:font.jp, textAlign:"center" }}>
        参加メンバー {listing.members ? listing.members.length : 0}人のグループチャット
      </div>

      {/* メッセージ一覧 */}
      <div ref={scrollRef} style={{ flex:1, overflowY:"auto", background:C.surface2, padding:"12px 12px",
        display:"flex", flexDirection:"column", gap:8 }}>
        {loading && (
          <div style={{ textAlign:"center", padding:"30px 0", fontSize:11, color:C.muted, fontFamily:font.jp }}>
            読み込み中…
          </div>
        )}
        {!loading && messages.length===0 && (
          <div style={{ textAlign:"center", padding:"40px 20px", color:C.muted, fontFamily:font.jp }}>
            <div style={{ fontSize:32, marginBottom:8 }}>💬</div>
            <div style={{ fontSize:12 }}>まだメッセージがありません。<br/>集合場所や時間を相談しましょう！</div>
          </div>
        )}
        {messages.map(m => {
          const mine = m.user_id === myId;
          return (
            <div key={m.id} style={{ display:"flex", flexDirection:"column",
              alignItems: mine ? "flex-end" : "flex-start" }}>
              {!mine && (
                <div style={{ fontSize:9, color:colorFor(m.user_id), fontWeight:700, marginBottom:2, marginLeft:4, fontFamily:font.jp }}>
                  {m.user_nickname || "メンバー"}
                </div>
              )}
              <div style={{ display:"flex", alignItems:"flex-end", gap:5,
                flexDirection: mine ? "row-reverse" : "row", maxWidth:"80%" }}>
                <div style={{ padding:"7px 11px", borderRadius: mine ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                  background: mine ? C.warm : C.surface, color: mine ? "#fff" : C.ink,
                  border: mine ? "none" : `1px solid ${C.border}`,
                  fontSize:12, lineHeight:1.6, fontFamily:font.jp, wordBreak:"break-word" }}>
                  {m.body}
                </div>
                <span style={{ fontSize:8, color:C.muted, flexShrink:0 }}>{timeStr(m.created_at)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 入力欄 */}
      <div style={{ display:"flex", alignItems:"flex-end", gap:8, padding:"9px 12px",
        background:C.surface, borderTop:`1px solid ${C.border}` }}>
        <textarea value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); handleSend(); } }}
          placeholder="メッセージを入力…" rows={1}
          style={{ flex:1, padding:"8px 12px", borderRadius:18, border:`1px solid ${C.border}`,
            background:C.surface2, fontSize:12, fontFamily:font.jp, color:C.ink, outline:"none",
            resize:"none", maxHeight:80, lineHeight:1.5 }}/>
        <button onClick={handleSend} disabled={!input.trim() || sending} className="btn-press"
          style={{ width:38, height:38, borderRadius:"50%", border:"none", flexShrink:0,
            background: input.trim() ? C.dark : "#ccc", color:"#fff", fontSize:16,
            cursor: input.trim()?"pointer":"default",
            display:"flex", alignItems:"center", justifyContent:"center" }}>
          {sending ? "…" : "➤"}
        </button>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   SCREEN: REVIEW（評価）
───────────────────────────────────────────── */
const ReviewScreen = ({ listing, onBack, onSubmit }) => {
  // 自分以外のメンバーを評価対象に
  // 自分以外のメンバーを評価対象に（API時はuserId、モック時は"あ"で判定）
  const targets = (listing.members || []).filter(m =>
    USE_API ? (m.userId && m.userId !== currentUserId) : m.n !== "あ"
  );
  const [idx, setIdx] = useState(0);
  const [scores, setScores] = useState({});      // { memberIndex: 1-5 }
  const [comments, setComments] = useState({});
  const [submitting, setSubmitting] = useState(false);

  if (targets.length === 0) {
    return (
      <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }}>
        <BackHeader title="評価" onBack={onBack}/>
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, padding:24 }}>
          <div style={{ fontSize:40, opacity:0.4 }}>🥚</div>
          <div style={{ fontSize:13, color:C.muted, fontFamily:font.jp }}>評価できるメンバーがいません</div>
        </div>
      </div>
    );
  }

  const target = targets[idx];
  const score = scores[idx] || 0;
  const isLast = idx === targets.length - 1;

  const setScore  = (s) => setScores(p => ({ ...p, [idx]: s }));
  const setComment= (c) => setComments(p => ({ ...p, [idx]: c }));

  const handleNext = () => {
    if (isLast) {
      setSubmitting(true);
      // 全員分の評価をまとめて親に渡す
      const reviews = targets.map((m, i) => ({ member:m, score:scores[i]||5, comment:comments[i]||"" }));
      setTimeout(()=> onSubmit(listing, reviews), 600);
    } else {
      setIdx(idx + 1);
    }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }}>
      <BackHeader title={`メンバーを評価 (${idx+1}/${targets.length})`} onBack={onBack}/>
      <div style={{ flex:1, overflowY:"auto", background:C.surface2, padding:"16px 14px",
        display:"flex", flexDirection:"column", alignItems:"center", gap:14 }}>

        {/* 対象メンバー */}
        <div className="pop-in" style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8, marginTop:8 }}>
          <AvatarChip {...target} size={64}/>
          <div style={{ fontSize:16, fontWeight:700, color:C.ink, fontFamily:font.jp }}>
            {target.fullName || target.n + "さん"}{target.host ? "（主催）" : ""}
          </div>
          <div style={{ fontSize:11, color:C.muted, fontFamily:font.jp }}>{listing.store} での取引</div>
        </div>

        {/* 星 */}
        <div style={{ display:"flex", gap:6 }}>
          {[1,2,3,4,5].map(n=>(
            <button key={n} onClick={()=>setScore(n)} className="btn-press"
              style={{ background:"none", border:"none", cursor:"pointer", fontSize:34,
                filter: n<=score ? "none" : "grayscale(1) opacity(0.3)", transition:"all 0.15s" }}>
              ⭐
            </button>
          ))}
        </div>
        <div style={{ fontSize:12, color: score?C.mid:C.muted, fontWeight:600, fontFamily:font.jp, height:16 }}>
          {["","よくなかった","いまひとつ","ふつう","よかった","とてもよかった"][score]}
        </div>

        {/* コメント */}
        <div style={{ width:"100%", background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:6, fontWeight:600, fontFamily:font.jp }}>
            💬 コメント（任意）
          </div>
          <textarea value={comments[idx]||""} onChange={e=>setComment(e.target.value)}
            placeholder="例：時間ぴったりに来てくれて助かりました！"
            maxLength={200} rows={3}
            style={{ width:"100%", padding:"7px 10px", background:C.surface2, borderRadius:9,
              border:`1px solid ${C.border}`, fontSize:12, fontFamily:font.jp, color:C.ink,
              outline:"none", resize:"none", lineHeight:1.6 }}/>
        </div>
      </div>

      <button onClick={handleNext} disabled={!score || submitting} className="btn-press"
        style={{ margin:"0 14px 16px", padding:12, borderRadius:13, border:"none",
          background: score ? C.dark : "#ccc", color:"#fff", fontSize:14, fontWeight:700,
          fontFamily:font.jp, cursor: score?"pointer":"default",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
        {submitting && <div style={{ width:16, height:16, border:"2px solid rgba(255,255,255,0.4)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>}
        {isLast ? (submitting ? "送信中…" : "評価を送信する ⭐") : "次のメンバーへ →"}
      </button>
    </div>
  );
};

/* ─────────────────────────────────────────────
   SCREEN: EDIT（募集の編集）
   集合日時・コメントを後から変更（主催者のみ）
───────────────────────────────────────────── */
const EditScreen = ({ listing, onBack, onSubmit }) => {
  // listing.time は "YYYY-MM-DDThh:mm"（投稿時）か整形済み文字列の可能性
  const initIso = (() => {
    if (listing.time && listing.time.includes("T")) return listing.time;
    return "";
  })();
  const [date, setDate] = useState(initIso ? initIso.split("T")[0] : "");
  const [time, setTime] = useState(initIso ? initIso.split("T")[1] : "18:00");
  const [comment, setComment] = useState(listing.comment || "");
  const [submitting, setSubmitting] = useState(false);

  const meetTime = date ? `${date}T${time}` : "";
  const valid = !!date;

  const handleSubmit = () => {
    if (!valid) return;
    setSubmitting(true);
    setTimeout(() => onSubmit(listing, { meet_at: meetTime, comment: comment.trim() }), 500);
  };

  const preview = (() => {
    if (!date) return "";
    const d = new Date(`${date}T${time}`);
    const dow = ["日","月","火","水","木","金","土"][d.getDay()];
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((new Date(date) - today) / 86400000);
    const prefix = diff===0 ? "今日 " : diff===1 ? "明日 " : "";
    return `${prefix}${date.slice(5).replace("-","/")}（${dow}）${time}〜`;
  })();

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }}>
      <BackHeader title="募集を編集" onBack={onBack}/>
      <div style={{ flex:1, overflowY:"auto", background:C.surface2, padding:"12px 12px", display:"flex", flexDirection:"column", gap:9 }}>

        {/* 変更できない情報（参考表示）*/}
        <div style={{ background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, overflow:"hidden", opacity:0.7 }}>
          {[["スーパー", listing.store],["パック", `${listing.pack}個入り ${listing.size}`],["価格", `¥${listing.price}`]].map(([l,v],i)=>(
            <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"7px 12px",
              borderBottom:i<2?`1px solid ${C.border}`:"none", fontSize:11, fontFamily:font.jp }}>
              <span style={{ color:C.muted }}>{l}</span><span style={{ color:C.ink, fontWeight:600 }}>{v}</span>
            </div>
          ))}
          <div style={{ padding:"5px 12px", fontSize:9, color:C.muted, background:C.surface2, fontFamily:font.jp }}>
            ※ スーパー・パック・価格は変更できません
          </div>
        </div>

        {/* 集合日時 */}
        <div style={{ background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:6, fontWeight:600, fontFamily:font.jp }}>🕕 集合日時</div>
          <div style={{ display:"flex", gap:6 }}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}
              style={{ flex:1, padding:"7px 9px", background:C.surface2, borderRadius:9,
                border:`1px solid ${C.border}`, fontSize:12, fontFamily:font.jp, color:C.ink, outline:"none" }}/>
            <input type="time" value={time} onChange={e=>setTime(e.target.value)}
              style={{ width:88, padding:"7px 9px", background:C.surface2, borderRadius:9,
                border:`1px solid ${C.border}`, fontSize:12, fontFamily:font.jp, color:C.ink, outline:"none" }}/>
          </div>
          {preview && <div style={{ marginTop:5, fontSize:10, color:C.green, fontWeight:600, fontFamily:font.jp }}>✓ {preview}</div>}
        </div>

        {/* コメント */}
        <div style={{ background:C.surface, borderRadius:13, border:`1px solid ${C.border}`, padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:6, fontWeight:600, fontFamily:font.jp }}>💬 コメント</div>
          <textarea value={comment} onChange={e=>setComment(e.target.value)} maxLength={100} rows={2}
            placeholder="例：駐車場前に集合しましょう！"
            style={{ width:"100%", padding:"7px 10px", background:C.surface2, borderRadius:9,
              border:`1px solid ${C.border}`, fontSize:12, fontFamily:font.jp, color:C.ink, outline:"none", resize:"none", lineHeight:1.6 }}/>
          <div style={{ textAlign:"right", fontSize:9, color:C.muted, marginTop:3 }}>{comment.length}/100</div>
        </div>
      </div>

      <button onClick={handleSubmit} disabled={!valid || submitting} className="btn-press"
        style={{ margin:"0 12px 14px", padding:12, borderRadius:13, border:"none",
          background: valid ? C.dark : "#ccc", color:"#fff", fontSize:14, fontWeight:700,
          fontFamily:font.jp, cursor: valid?"pointer":"default",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
        {submitting && <div style={{ width:16, height:16, border:"2px solid rgba(255,255,255,0.4)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>}
        {submitting ? "保存中…" : "変更を保存する"}
      </button>
    </div>
  );
};

/* ─────────────────────────────────────────────
   SCREEN: MY LISTINGS (参加中)
───────────────────────────────────────────── */
const MyListingsScreen = ({ joinedListings, postedListings, onSelect, onNavigate, onCloseListing, onDeleteListing, onCancelJoin, onReview, onEdit, onChat, hasUnread, unreadTotal }) => {
  const [tab, setTab] = useState("joined");
  const [confirmAction, setConfirmAction] = useState(null); // { type, listing }

  const isFinished = (l) => l.status === "completed" || l.status === "cancelled";
  // アクティブな募集のみ各タブに表示
  const joinedActive = joinedListings.filter(l => !isFinished(l));
  const postedActive = postedListings.filter(l => !isFinished(l));
  // 履歴：参加・主催どちらも含め、完了/中止したもの（重複排除）
  const historyMap = {};
  [...joinedListings, ...postedListings].forEach(l => { if (isFinished(l)) historyMap[l.id] = l; });
  const history = Object.values(historyMap).sort((a,b) => new Date(b.time) - new Date(a.time));

  const active = tab === "joined" ? joinedActive : tab === "posted" ? postedActive : history;

  const perEgg = (l) => Math.ceil(l.price / l.pack);

  const StatusChip = ({ listing }) => {
    if (listing.status === "completed") return <span style={{ fontSize:9, padding:"2px 7px", borderRadius:20, background:C.greenBg, color:C.green, fontWeight:700, fontFamily:font.jp }}>完了</span>;
    if (listing.status === "cancelled") return <span style={{ fontSize:9, padding:"2px 7px", borderRadius:20, background:C.redBg, color:C.red, fontWeight:700, fontFamily:font.jp }}>中止</span>;
    const pct = listing.confirmed / listing.pack;
    if (pct >= 1)   return <span style={{ fontSize:9, padding:"2px 7px", borderRadius:20, background:C.greenBg, color:C.green, fontWeight:700, fontFamily:font.jp }}>満員</span>;
    return <span style={{ fontSize:9, padding:"2px 7px", borderRadius:20, background:C.light, color:C.mid, fontWeight:700, fontFamily:font.jp }}>募集中</span>;
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"10px 16px 10px", borderBottom:`1px solid ${C.border}`, background:C.surface, flexShrink:0 }}>
        <div style={{ fontFamily:font.num, fontSize:20, fontWeight:700, color:C.dark, letterSpacing:-0.5, marginBottom:10 }}>
          📋 管理
        </div>
        <div style={{ display:"flex", gap:4 }}>
          {[["joined","参加予定",joinedActive.length],["posted","自分の募集",postedActive.length],["history","履歴",history.length]].map(([key,label,count])=>(
            <button key={key} onClick={()=>setTab(key)} className="btn-press"
              style={{ flex:1, padding:"6px 0", borderRadius:9, border:"none",
                background: tab===key ? C.warm : C.surface2,
                color: tab===key ? "#fff" : C.muted,
                fontSize:12, fontWeight:700, fontFamily:font.jp, cursor:"pointer",
                transition:"all 0.2s" }}>
              {label}
              {count>0 &&
                <span style={{ marginLeft:4, background:"rgba(255,255,255,0.3)", borderRadius:10, padding:"1px 5px", fontSize:10 }}>{count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="fade-in" style={{ flex:1, overflowY:"auto", background:C.surface2, padding:"10px 11px", display:"flex", flexDirection:"column", gap:8 }}>
        {active.length === 0 ? (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            gap:10, padding:"48px 24px", color:C.muted, fontFamily:font.jp, textAlign:"center" }}>
            <div style={{ fontSize:40, opacity:0.4 }}>{tab==="history" ? "🗂️" : "🥚"}</div>
            <div style={{ fontSize:13, fontWeight:500 }}>
              {tab==="joined" ? "参加予定の募集はありません" : tab==="posted" ? "募集中の自分の投稿はありません" : "履歴はまだありません"}
            </div>
            <div style={{ fontSize:11, color:C.muted, lineHeight:1.7 }}>
              {tab==="joined" ? "フィードから募集に参加してみよう" : tab==="posted" ? "＋ボタンから買い出し募集を投稿しよう" : "完了・中止した募集がここに表示されます"}
            </div>
          </div>
        ) : active.map((l, i) => {
          const myEntry = l.members.find(m => m.n==="あ");
          const myEggs  = myEntry ? myEntry.eggs : l.myEggs || 0;
          const isHost  = myEntry?.host || l.isPostedByMe;
          return (
            <div key={l.id} className="hover-card fade-up" onClick={()=>onSelect(l)}
              style={{ animationDelay:`${i*0.05}s`, background:C.surface, borderRadius:14,
                border:`1px solid ${C.border}`, overflow:"hidden",
                boxShadow:"0 2px 10px rgba(120,80,0,0.07)" }}>
              {/* Card header bar */}
              <div style={{ background: isHost ? C.dark : C.mid, padding:"7px 12px",
                display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#fff", fontFamily:font.jp }}>
                  🏪 {l.store}
                </div>
                <StatusChip listing={l}/>
              </div>
              <div style={{ padding:"10px 12px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:7 }}>
                  <div style={{ fontSize:11, color:C.ink, fontFamily:font.jp }}>
                    <span style={{ fontWeight:700 }}>{l.pack}個入り {l.size}</span>
                    <span style={{ color:C.muted, marginLeft:6 }}>¥{l.price}</span>
                  </div>
                  <div style={{ fontSize:11, color:C.mid, fontWeight:600, fontFamily:font.jp }}>{formatTime(l.time)}</div>
                </div>
                <ProgressBar filled={l.confirmed} total={l.pack}/>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:8 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:2 }}>
                    {l.members.slice(0,4).map((m,j)=><AvatarChip key={j} {...m}/>)}
                    {l.members.length > 4 && <span style={{ fontSize:10, color:C.muted, marginLeft:4 }}>+{l.members.length-4}</span>}
                  </div>
                  {myEggs > 0 && (
                    <div style={{ background:C.light, border:`1px solid #F5C060`, borderRadius:8,
                      padding:"3px 8px", fontSize:10, fontWeight:600, color:C.dark, fontFamily:font.jp }}>
                      🥚 {myEggs}個 ¥{myEggs * perEgg(l)}
                    </div>
                  )}
                </div>
                {isHost && l.status !== "completed" && l.status !== "cancelled" && (
                  <div style={{ marginTop:8, fontSize:10, color:C.green, fontWeight:600, fontFamily:font.jp,
                    display:"flex", alignItems:"center", gap:4 }}>
                    ✦ あなたが主催しています
                  </div>
                )}

                {/* アクションボタン */}
                {l.status !== "completed" && l.status !== "cancelled" && (
                  <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:10 }} onClick={e=>e.stopPropagation()}>
                    {isHost ? (
                      <>
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={()=>setConfirmAction({ type:"close", listing:l })} className="btn-press"
                            style={{ flex:1, padding:"7px 0", borderRadius:8, border:"none", background:C.green,
                              color:"#fff", fontSize:11, fontWeight:700, fontFamily:font.jp, cursor:"pointer" }}>
                            締め切って集合確定
                          </button>
                          <button onClick={()=>setConfirmAction({ type:l.confirmed>l.poster_eggs?"cancel":"delete", listing:l })} className="btn-press"
                            style={{ padding:"7px 12px", borderRadius:8, border:`1px solid ${C.border}`,
                              background:C.surface, color:C.red, fontSize:11, fontWeight:600, fontFamily:font.jp, cursor:"pointer" }}>
                            中止
                          </button>
                        </div>
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={()=>onChat && onChat(l)} className="btn-press"
                            style={{ flex:1, padding:"7px 0", borderRadius:8, border:"none", background:C.dark,
                              color:"#fff", fontSize:11, fontWeight:700, fontFamily:font.jp, cursor:"pointer", position:"relative" }}>
                            💬 チャット
                            {hasUnread && hasUnread(l.id) && (
                              <span style={{ position:"absolute", top:4, right:8, width:8, height:8, borderRadius:"50%", background:C.red, border:"1.5px solid #fff" }}/>
                            )}
                          </button>
                          <button onClick={()=>onEdit && onEdit(l)} className="btn-press"
                            style={{ flex:1, padding:"7px 0", borderRadius:8, border:`1px solid ${C.border}`,
                              background:C.surface, color:C.mid, fontSize:11, fontWeight:600, fontFamily:font.jp, cursor:"pointer" }}>
                            ✏️ 編集
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{ display:"flex", gap:6 }}>
                        <button onClick={()=>onChat && onChat(l)} className="btn-press"
                          style={{ flex:1, padding:"7px 0", borderRadius:8, border:"none", background:C.dark,
                            color:"#fff", fontSize:11, fontWeight:700, fontFamily:font.jp, cursor:"pointer", position:"relative" }}>
                          💬 チャット
                          {hasUnread && hasUnread(l.id) && (
                            <span style={{ position:"absolute", top:4, right:8, width:8, height:8, borderRadius:"50%", background:C.red, border:"1.5px solid #fff" }}/>
                          )}
                        </button>
                        <button onClick={()=>setConfirmAction({ type:"leave", listing:l })} className="btn-press"
                          style={{ flex:1, padding:"7px 0", borderRadius:8, border:`1px solid ${C.border}`,
                            background:C.surface, color:C.red, fontSize:11, fontWeight:600, fontFamily:font.jp, cursor:"pointer" }}>
                          参加をキャンセル
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 完了後：評価ボタン（参加者・主催者とも） */}
                {l.status === "completed" && (
                  <div style={{ marginTop:10 }} onClick={e=>e.stopPropagation()}>
                    <button onClick={()=>onReview && onReview(l)} className="btn-press"
                      style={{ width:"100%", padding:"7px 0", borderRadius:8, border:"none", background:C.warm,
                        color:"#fff", fontSize:11, fontWeight:700, fontFamily:font.jp, cursor:"pointer" }}>
                      ⭐ メンバーを評価する
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div style={{ height:8 }}/>
      </div>

      {/* 確認ダイアログ */}
      {confirmAction && (() => {
        const { type, listing } = confirmAction;
        const conf = {
          close:  { title:"募集を締め切りますか？", msg:"締め切ると新しい参加者を受け付けなくなり、集合が確定します。", btn:"締め切る", color:C.green,
                    run:()=>onCloseListing && onCloseListing(listing) },
          cancel: { title:"募集を中止しますか？", msg:"参加者がいます。中止すると全員の参加が取り消されます。", btn:"中止する", color:C.red,
                    run:()=>onDeleteListing && onDeleteListing(listing, true) },
          delete: { title:"募集を削除しますか？", msg:"この募集を削除します。元に戻せません。", btn:"削除する", color:C.red,
                    run:()=>onDeleteListing && onDeleteListing(listing, false) },
          leave:  { title:"参加をキャンセルしますか？", msg:"あなたの参加が取り消され、卵の枠が他の人に開放されます。", btn:"キャンセルする", color:C.red,
                    run:()=>onCancelJoin && onCancelJoin(listing) },
        }[type];
        return (
          <div onClick={()=>setConfirmAction(null)}
            style={{ position:"absolute", inset:0, background:"rgba(28,18,8,0.45)", zIndex:50,
              display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px" }}>
            <div onClick={e=>e.stopPropagation()} className="pop-in"
              style={{ background:C.surface, borderRadius:18, padding:"18px 18px 14px", width:"100%", maxWidth:280,
                boxShadow:"0 16px 48px rgba(0,0,0,0.3)" }}>
              <div style={{ fontSize:15, fontWeight:700, color:C.ink, fontFamily:font.jp, marginBottom:7 }}>{conf.title}</div>
              <div style={{ fontSize:12, color:C.muted, lineHeight:1.7, fontFamily:font.jp, marginBottom:16 }}>{conf.msg}</div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>setConfirmAction(null)} className="btn-press"
                  style={{ flex:1, padding:10, borderRadius:10, border:`1px solid ${C.border}`,
                    background:C.surface, color:C.muted, fontSize:12, fontWeight:600, fontFamily:font.jp, cursor:"pointer" }}>
                  やめる
                </button>
                <button onClick={()=>{ conf.run(); setConfirmAction(null); }} className="btn-press"
                  style={{ flex:1, padding:10, borderRadius:10, border:"none",
                    background:conf.color, color:"#fff", fontSize:12, fontWeight:700, fontFamily:font.jp, cursor:"pointer" }}>
                  {conf.btn}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <BottomNav active="my" onNavigate={onNavigate} myBadge={unreadTotal}/>
    </div>
  );
};

/* ─────────────────────────────────────────────
   PHONE FRAME
───────────────────────────────────────────── */
const PhoneFrame = ({ children }) => (
  <div style={{ display:"flex", justifyContent:"center", alignItems:"flex-start", minHeight:"100vh",
    padding:"32px 16px 60px", background:"linear-gradient(160deg,#E8DFC8 0%,#D4C8A8 100%)",
    fontFamily:font.jp }}>
    <div style={{ width:320, background:C.surface, borderRadius:42,
      border:"1.5px solid rgba(180,140,60,0.22)",
      boxShadow:"0 24px 64px rgba(80,50,0,0.22), inset 0 1px 0 rgba(255,255,255,0.8)",
      overflow:"hidden", display:"flex", flexDirection:"column",
      minHeight:640, position:"relative" }}>
      {/* Notch */}
      <div style={{ width:90, height:24, background:C.ink, borderRadius:"0 0 16px 16px",
        margin:"0 auto", flexShrink:0, zIndex:10 }}/>
      {/* Status bar */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"6px 20px 3px", fontFamily:font.num, fontSize:11, fontWeight:600, color:C.soft, flexShrink:0 }}>
        <span>9:41</span><span>🔋</span>
      </div>
      {/* Content */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", position:"relative" }}>
        {children}
      </div>
    </div>
  </div>
);

/* ─────────────────────────────────────────────
   APP ROOT
───────────────────────────────────────────── */
export default function App() {
  const [screen, setScreen] = useState("onboard");
  const [listings, setListings] = useState(USE_API ? [] : INIT_LISTINGS);
  const [selected, setSelected] = useState(null);
  const [joinedEggs, setJoinedEggs] = useState(0);
  const [joinedIds, setJoinedIds] = useState([]);
  const [postedIds, setPostedIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [coords, setCoords] = useState({ lat:35.6595, lng:139.7005 }); // デフォルト：渋谷駅
  const [locName, setLocName] = useState("渋谷区周辺");
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState(null);  // { msg, type }
  const [chatBackTo, setChatBackTo] = useState("my");  // チャットから戻る画面
  // チャット未読管理：{ listingId: 最後に開いた時刻(ms) } と { listingId: 最新メッセージ時刻(ms) }
  const [chatLastSeen, setChatLastSeen] = useState({});
  const [chatLatest, setChatLatest] = useState({});
  const toastTimer = useRef(null);

  // ── トースト通知 ──
  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  // ── 差分更新ヘルパー ──
  // 1件の募集だけを部分更新（全件再取得を避ける）
  const patchListing = (id, patch) => {
    setListings(prev => prev.map(l => l.id === id
      ? { ...l, ...(typeof patch === "function" ? patch(l) : patch) }
      : l));
    // 詳細画面で選択中の募集も同期
    setSelected(prev => prev && prev.id === id
      ? { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }
      : prev);
  };
  // 1件をリストから除去
  const removeListing = (id) => {
    setListings(prev => prev.filter(l => l.id !== id));
  };
  // APIから1件だけ取り直して反映（サーバーの確定値で同期したいとき）
  const refreshOne = async (id) => {
    if (!USE_API) return;
    try {
      const row = await api.getListing(id);
      const adapted = adaptListing(row);
      setListings(prev => prev.map(l => l.id === id ? adapted : l));
    } catch (e) { /* 取得失敗時は楽観的更新のまま */ }
  };

  // ── 現在地を取得 ──
  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError("この端末では現在地を取得できません");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(c);
        setLocName("現在地周辺");
        setLocating(false);
        if (USE_API) fetchListings(c);
      },
      (err) => {
        setLocating(false);
        setError("現在地の取得が許可されませんでした");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // ── 募集一覧の取得（API有効時のみ）──
  const fetchListings = async (c) => {
    if (!USE_API) return;
    const loc = c || coords;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getListings({ lat:loc.lat, lng:loc.lng, radius:2000 });
      setListings((res.listings || []).map(adaptListing));
    } catch (e) {
      setError(e.message || "募集の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  // フィードに入ったら取得
  useEffect(() => {
    if (USE_API && screen === "feed") fetchListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const handleJoin = async (listing, eggs) => {
    if (USE_API) {
      try {
        const res = await api.join(listing.id, eggs);
        setJoinedEggs(eggs);
        setJoinedIds(prev => prev.includes(listing.id) ? prev : [...prev, listing.id]);
        // 全件再取得せず、該当募集だけAPIの確定値で更新
        patchListing(listing.id, (l) => ({
          confirmed: res.confirmed_count != null ? res.confirmed_count : l.confirmed + eggs,
          status: res.listing_status || l.status,
          members: [...l.members, { n:"あ", fullName:"あなた", userId:currentUserId, c:C.warm, bg:C.light, eggs }],
        }));
        setScreen("confirmed");
      } catch (e) {
        showToast(e.message || "参加に失敗しました", "error");
      }
      return;
    }
    // ── モック動作 ──
    setJoinedEggs(eggs);
    setJoinedIds(prev => prev.includes(listing.id) ? prev : [...prev, listing.id]);
    patchListing(listing.id, (l) => ({
      confirmed: l.confirmed + eggs,
      members: [...l.members, { n:"あ", c:C.warm, bg:C.light, eggs }],
    }));
    setScreen("confirmed");
  };

  const handlePost = async ({ store, pack, size, price, myEggs, time, comment }) => {
    if (USE_API) {
      try {
        const created = await api.createListing({
          store_name: store, store_lat: coords.lat, store_lng: coords.lng,
          pack_size: pack, egg_size: size, price_total: price,
          poster_eggs: myEggs, meet_at: new Date(time).toISOString(), comment,
        });
        // 全件再取得せず、作成された募集を先頭に追加
        const adapted = adaptListing({ ...created, applications: [], poster_nickname: "あなた" });
        adapted.isPostedByMe = true;
        setListings(prev => [adapted, ...prev]);
        setPostedIds(prev => [...prev, created.id]);
        showToast("募集を公開しました 🥚", "success");
        setScreen("feed");
      } catch (e) {
        showToast(e.message || "投稿に失敗しました", "error");
      }
      return;
    }
    // ── モック動作 ──
    const newId = Date.now();
    const newListing = {
      id: newId, store, dist:120, pack, size, price, time, comment,
      confirmed:myEggs, members:[{n:"あ",c:C.warm,bg:C.light,eggs:myEggs,host:true}],
      isPostedByMe: true,
      lat:0.42+Math.random()*0.1, lng:0.42+Math.random()*0.1,
    };
    setListings(prev => [newListing, ...prev]);
    setPostedIds(prev => [...prev, newId]);
    setScreen("feed");
  };

  const joinedListings = listings.filter(l => joinedIds.includes(l.id));
  const postedListings = listings.filter(l => postedIds.includes(l.id) || l.isPostedByMe);

  // ── 通知の計算（自分が関わる募集から） ──
  const notifications = (() => {
    const items = [];
    const now = Date.now();
    const seen = {};
    [...postedListings, ...joinedListings].forEach(l => {
      if (seen[l.id]) return; seen[l.id] = true;
      if (l.status === "completed" || l.status === "cancelled") return;
      const isHost = postedListings.some(p => p.id === l.id);
      // 満員になった自分の募集
      if (isHost && l.confirmed >= l.pack) {
        items.push({ id:`full-${l.id}`, icon:"🎉", text:`「${l.store}」が満員になりました！締め切れます`, listing:l });
      }
      // 集合が近い（3時間以内）
      const t = new Date(l.time).getTime();
      const diffH = (t - now) / 3600000;
      if (diffH > 0 && diffH <= 3) {
        items.push({ id:`soon-${l.id}`, icon:"⏰", text:`まもなく集合：「${l.store}」${formatTime(l.time)}`, listing:l });
      }
    });
    return items;
  })();

  // ── 募集を締め切る（主催者）──
  const handleCloseListing = async (listing) => {
    if (USE_API) {
      try {
        await api.setListingStatus(listing.id, "completed");
        patchListing(listing.id, { status:"completed" });   // 差分更新
        showToast("募集を締め切りました", "success");
      }
      catch (e) { showToast(e.message || "締め切りに失敗しました", "error"); }
      return;
    }
    patchListing(listing.id, { status:"completed" });
    showToast("募集を締め切りました", "success");
  };

  // ── 募集を中止／削除（主催者）──
  const handleDeleteListing = async (listing, hasMembers) => {
    if (USE_API) {
      try {
        if (hasMembers) {
          await api.setListingStatus(listing.id, "cancelled");
          patchListing(listing.id, { status:"cancelled" });   // 中止は残して状態変更
        } else {
          await api.deleteListing(listing.id);
          removeListing(listing.id);                          // 削除はリストから除去
          setPostedIds(prev => prev.filter(id => id!==listing.id));
        }
        showToast(hasMembers ? "募集を中止しました" : "募集を削除しました", "success");
      } catch (e) { showToast(e.message || "中止に失敗しました", "error"); }
      return;
    }
    if (hasMembers) patchListing(listing.id, { status:"cancelled" });
    else { removeListing(listing.id); setPostedIds(prev => prev.filter(id => id!==listing.id)); }
    showToast(hasMembers ? "募集を中止しました" : "募集を削除しました", "success");
  };

  // ── 参加をキャンセル（参加者）──
  const handleCancelJoin = async (listing) => {
    if (USE_API) {
      try {
        // 自分のapplication_idを募集詳細から探す
        const detail = await api.getListing(listing.id);
        const mine = (detail.applications || []).find(a => a.user_id === currentUserId);
        let newCount = listing.confirmed;
        if (mine) {
          const res = await api.cancelApplication(mine.id);
          if (res && res.confirmed_count != null) newCount = res.confirmed_count;
          else newCount = Math.max(0, listing.confirmed - mine.egg_count);
        }
        setJoinedIds(prev => prev.filter(id => id!==listing.id));
        // 差分更新：自分を除外し、確定数を反映
        patchListing(listing.id, (l) => ({
          confirmed: newCount,
          status: "open",
          members: l.members.filter(m => m.userId !== currentUserId && m.n !== "あ"),
        }));
        showToast("参加をキャンセルしました", "success");
      } catch (e) { showToast(e.message || "キャンセルに失敗しました", "error"); }
      return;
    }
    // モック：自分の参加分を戻す
    patchListing(listing.id, (l) => {
      const mine = l.members.find(m => m.n==="あ");
      const eggs = mine ? mine.eggs : 0;
      return { confirmed: Math.max(0, l.confirmed - eggs), members: l.members.filter(m => m.n!=="あ") };
    });
    setJoinedIds(prev => prev.filter(id => id!==listing.id));
    showToast("参加をキャンセルしました", "success");
  };

  // ── 募集を編集（主催者）──
  const handleEditListing = async (listing, changes) => {
    if (USE_API) {
      try {
        await api.updateListing(listing.id, changes);
        patchListing(listing.id, { time: changes.meet_at, comment: changes.comment });  // 差分更新
        showToast("変更を保存しました", "success");
      }
      catch (e) { showToast(e.message || "編集に失敗しました", "error"); }
      setScreen("my");
      return;
    }
    patchListing(listing.id, { time: changes.meet_at, comment: changes.comment });
    setScreen("my");
  };

  // ── 評価を送信 ──
  const handleReviewSubmit = async (listing, reviews) => {
    if (USE_API) {
      try {
        for (const r of reviews) {
          if (!r.member.userId) continue;
          await api.postReview(listing.id, {
            reviewed_user_id: r.member.userId,
            score: r.score,
            comment: r.comment || undefined,
          });
        }
        showToast("評価を送信しました ⭐", "success");
      } catch (e) {
        showToast(e.message || "評価の送信に失敗しました", "error");
      }
    } else {
      showToast("評価を送信しました ⭐", "success");
    }
    setScreen("my");
  };

  // ── チャット未読判定 ──
  const hasUnread = (listingId) => {
    const latest = chatLatest[listingId];
    const seen = chatLastSeen[listingId] || 0;
    return latest && latest > seen;
  };
  // 自分が関わる募集のうち未読があるものの数
  const unreadCount = [...joinedListings, ...postedListings]
    .filter((l,i,arr) => arr.findIndex(x=>x.id===l.id)===i)  // 重複排除
    .filter(l => hasUnread(l.id)).length;

  // チャットを開く（既読化 + 遷移）
  const openChat = (listing, backTo) => {
    setSelected(listing);
    setChatBackTo(backTo || "my");
    setChatLastSeen(prev => ({ ...prev, [listing.id]: Date.now() }));
    setScreen("chat");
  };
  // ChatScreenから最新メッセージ時刻の報告を受ける
  const reportLatest = (listingId, ts) => {
    setChatLatest(prev => (prev[listingId] === ts ? prev : { ...prev, [listingId]: ts }));
  };

  // ── ユーザーをブロック ──
  const handleBlockUser = async (member) => {
    const name = member.fullName || (member.n + "さん");
    if (USE_API) {
      try {
        await api.blockUser(member.userId);
        showToast(`${name}をブロックしました`, "success");
        await fetchListings();   // ブロック相手の募集を除外して再取得
        setScreen("feed");
      } catch (e) { showToast(e.message || "ブロックに失敗しました", "error"); }
      return;
    }
    showToast(`${name}をブロックしました`, "success");
  };

  const navigate = (key) => {
    if (key === "feed")    setScreen("feed");
    if (key === "my")      setScreen("my");
    if (key === "profile") setScreen("profile");
  };

  const renderScreen = () => {
    switch(screen) {
      case "onboard":  return <OnboardScreen onStart={()=>setScreen("feed")}/>;
      case "feed":     return <FeedScreen listings={listings} loading={loading} error={error}
                                onRetry={()=>fetchListings()} onRefresh={()=>fetchListings()}
                                locName={locName} locating={locating} onLocate={getCurrentLocation}
                                notifications={notifications}
                                onSelect={l=>{ setSelected(l); setScreen("detail"); }} onPost={()=>setScreen("post")} onNavigate={navigate} unreadTotal={unreadCount}/>;
      case "detail":   return selected ? <DetailScreen listing={selected} onBack={()=>setScreen("feed")} onJoin={handleJoin} onBlock={handleBlockUser}/> : null;
      case "post":     return <PostScreen onBack={()=>setScreen("feed")} onSubmit={handlePost}/>;
      case "confirmed":return selected ? <ConfirmedScreen listing={selected} eggs={joinedEggs} onBack={()=>setScreen("my")} onChat={l=>openChat(l,"my")}/> : null;
      case "my":       return <MyListingsScreen
                                joinedListings={joinedListings} postedListings={postedListings}
                                onSelect={l=>{ setSelected(l); setScreen("detail"); }}
                                onNavigate={navigate}
                                onCloseListing={handleCloseListing}
                                onDeleteListing={handleDeleteListing}
                                onCancelJoin={handleCancelJoin}
                                onReview={l=>{ setSelected(l); setScreen("review"); }}
                                onEdit={l=>{ setSelected(l); setScreen("edit"); }}
                                onChat={l=>openChat(l,"my")}
                                hasUnread={hasUnread}
                                unreadTotal={unreadCount}/>;
      case "edit":     return selected ? <EditScreen listing={selected} onBack={()=>setScreen("my")} onSubmit={handleEditListing}/> : null;
      case "review":   return selected ? <ReviewScreen listing={selected} onBack={()=>setScreen("my")} onSubmit={handleReviewSubmit}/> : null;
      case "chat":     return selected ? <ChatScreen listing={selected} onBack={()=>setScreen(chatBackTo)} onLatest={reportLatest}/> : null;
      case "profile":  return <ProfileScreen joinedListings={joinedListings} postedListings={postedListings} onNavigate={navigate} onManageBlocks={()=>setScreen("blocks")} unreadTotal={unreadCount}/>;
      case "blocks":   return <BlocksScreen onBack={()=>setScreen("profile")} showToast={showToast}/>;
      default:         return null;
    }
  };

  return (
    <>
      <FontLoader/>
      <PhoneFrame>
        {renderScreen()}
        {toast && (
          <div className="slide-up" style={{ position:"absolute", left:16, right:16, bottom:80, zIndex:100,
            display:"flex", alignItems:"center", gap:8, padding:"11px 14px", borderRadius:12,
            background: toast.type==="error" ? C.red : toast.type==="success" ? C.green : C.dark,
            color:"#fff", boxShadow:"0 8px 24px rgba(0,0,0,0.25)", fontFamily:font.jp }}>
            <span style={{ fontSize:15 }}>{toast.type==="error" ? "⚠️" : toast.type==="success" ? "✓" : "ℹ️"}</span>
            <span style={{ fontSize:12, fontWeight:600, flex:1, lineHeight:1.5 }}>{toast.msg}</span>
            <span onClick={()=>setToast(null)} style={{ cursor:"pointer", fontSize:14, opacity:0.8 }}>×</span>
          </div>
        )}
      </PhoneFrame>
    </>
  );
}
