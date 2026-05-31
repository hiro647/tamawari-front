// ──────────────────────────────────────────────────────────────
// たまわり — Google Maps 連携コンポーネント
//
// 【使い方】
// 1. Google Maps APIキーを取得（手順は GOOGLE_MAPS_SETUP.md 参照）
// 2. 下の GOOGLE_MAPS_API_KEY にキーを貼り付ける
// 3. tamawari.jsx（App.jsx）の該当箇所を、このファイルの
//    コンポーネントで置き換える（手順は同ファイル末尾のコメント参照）
//
// このファイルは @react-google-maps/api を使います。
// Viteプロジェクトで:  npm install @react-google-maps/api
// ──────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  GoogleMap, useJsApiLoader, MarkerF, InfoWindowF, Autocomplete
} from "@react-google-maps/api";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";

// Places Autocomplete に必要なライブラリ
const LIBRARIES = ["places"];

// 渋谷駅あたりをデフォルト中心に
const DEFAULT_CENTER = { lat: 35.6595, lng: 139.7005 };

const C = {
  warm:"#F5A623", dark:"#7B4F00", green:"#3D7A45", red:"#C0392B",
  ink:"#1C1208", muted:"#8B7560", surface:"#FFFDF8", border:"#EDE4D0", light:"#FEF0D0",
};
const font = { jp:"'Noto Sans JP', sans-serif" };

// ══════════════════════════════════════════════
// 1. フィードのマップビュー（実際のGoogle Map + 募集マーカー）
// ══════════════════════════════════════════════
export function RealMapView({ listings, onSelect }) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });
  const [activeId, setActiveId] = useState(null);
  const mapRef = useRef(null);

  // 座標を持つ募集だけを地図対象にする（座標が変わった時だけ再計算）
  const mappable = useMemo(
    () => listings.filter(
      l => typeof l.store_lat === "number" && typeof l.store_lng === "number"
    ),
    [listings]
  );

  // 地図ロード時・募集変更時に全ピンが収まるよう表示範囲を自動調整
  const fitToMarkers = useCallback((map) => {
    if (!map || mappable.length === 0) return;
    if (mappable.length === 1) {
      map.setCenter({ lat: mappable[0].store_lat, lng: mappable[0].store_lng });
      map.setZoom(16);
      return;
    }
    const bounds = new window.google.maps.LatLngBounds();
    mappable.forEach(l => bounds.extend({ lat: l.store_lat, lng: l.store_lng }));
    map.fitBounds(bounds, 60);
  }, [mappable]);

  const onLoad = useCallback((map) => {
    mapRef.current = map;
    fitToMarkers(map);
  }, [fitToMarkers]);

  useEffect(() => {
    if (mapRef.current) fitToMarkers(mapRef.current);
  }, [fitToMarkers]);

  const markerColor = (l) => {
    const pct = l.confirmed / l.pack;
    if (pct >= 0.9) return C.red;
    if (pct >= 0.5) return C.green;
    return C.dark;
  };

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
        flexDirection:"column", gap:8, background:"#E8F5E9", padding:24, textAlign:"center" }}>
        <div style={{ fontSize:32 }}>🗺️</div>
        <div style={{ fontSize:12, color:C.muted, fontFamily:font.jp, lineHeight:1.7 }}>
          Google Maps APIキーが未設定です。<br/>
          GoogleMaps.jsx の GOOGLE_MAPS_API_KEY に<br/>キーを貼り付けてください。
        </div>
      </div>
    );
  }
  if (!isLoaded) {
    return (
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", background:"#E8F5E9" }}>
        <div style={{ fontSize:12, color:C.muted, fontFamily:font.jp }}>地図を読み込み中…</div>
      </div>
    );
  }

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
      <GoogleMap
        mapContainerStyle={{ width:"100%", flex:1, minHeight:200 }}
        center={mappable[0] ? { lat:mappable[0].store_lat, lng:mappable[0].store_lng } : DEFAULT_CENTER}
        zoom={15}
        onLoad={onLoad}
        options={{ disableDefaultUI:true, zoomControl:true, gestureHandling:"greedy" }}
      >
        {mappable.map(l => (
          <MarkerF
            key={l.id}
            position={{ lat:l.store_lat, lng:l.store_lng }}
            onClick={() => setActiveId(l.id)}
            label={{ text:`${l.confirmed}/${l.pack}`, color:"#fff", fontSize:"10px", fontWeight:"bold" }}
            icon={{
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 14,
              fillColor: markerColor(l),
              fillOpacity: 1,
              strokeColor: "#fff",
              strokeWeight: 2,
            }}
          >
            {activeId === l.id && (
              <InfoWindowF onCloseClick={() => setActiveId(null)}>
                <div onClick={() => onSelect(l)} style={{ cursor:"pointer", fontFamily:font.jp, minWidth:120 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:C.ink }}>{l.store_name || l.store}</div>
                  <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>
                    残り{l.pack - l.confirmed}個・¥{Math.ceil((l.price_total||l.price)/l.pack)}/個
                  </div>
                  <div style={{ fontSize:10, color:C.warm, fontWeight:700, marginTop:3 }}>タップで詳細 ›</div>
                </div>
              </InfoWindowF>
            )}
          </MarkerF>
        ))}
      </GoogleMap>
    </div>
  );
}

// ══════════════════════════════════════════════
// 2. 募集詳細の地図（店舗位置を1点表示）
// ══════════════════════════════════════════════
export function RealStoreMap({ lat, lng, storeName }) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  if (!GOOGLE_MAPS_API_KEY || !isLoaded) {
    return (
      <div style={{ width:"100%", height:105, background:"#C5E1A5",
        display:"flex", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontSize:11, color:C.dark, fontFamily:font.jp }}>
          {GOOGLE_MAPS_API_KEY ? "地図を読み込み中…" : "📍 " + storeName}
        </span>
      </div>
    );
  }

  return (
    <div style={{ width:"100%", height:105, position:"relative" }}>
      <GoogleMap
        mapContainerStyle={{ width:"100%", height:"100%" }}
        center={{ lat, lng }}
        zoom={16}
        options={{ disableDefaultUI:true, gestureHandling:"none" }}
      >
        <MarkerF position={{ lat, lng }} />
      </GoogleMap>
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
        target="_blank" rel="noopener noreferrer"
        style={{ position:"absolute", bottom:6, left:7, background:C.warm, borderRadius:7,
          padding:"3px 8px", fontSize:9, fontWeight:700, color:"#fff", fontFamily:font.jp,
          textDecoration:"none" }}>
        Google マップで開く
      </a>
    </div>
  );
}

// ══════════════════════════════════════════════
// 3. 投稿フォームのスーパー検索（Places Autocomplete）
//    onSelect({ name, address, lat, lng, placeId }) を返す
// ══════════════════════════════════════════════
export function PlacesSearchInput({ onSelect, types = ["establishment"], placeholder = "スーパー名で検索…" }) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });
  const acRef = useRef(null);
  const [value, setValue] = useState("");

  const onLoad = useCallback((ac) => { acRef.current = ac; }, []);
  const onPlaceChanged = () => {
    const place = acRef.current?.getPlace();
    if (!place || !place.geometry) return;
    const result = {
      name: place.name,
      address: place.formatted_address,
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
      placeId: place.place_id,
    };
    setValue(place.name);
    onSelect(result);
  };

  if (!GOOGLE_MAPS_API_KEY || !isLoaded) {
    return (
      <input
        value={value}
        onChange={e => { setValue(e.target.value); onSelect({ name:e.target.value }); }}
        placeholder={placeholder + "（手入力）"}
        style={{ width:"100%", padding:"7px 10px", borderRadius:9, border:`1px solid ${C.border}`,
          fontSize:12, fontFamily:font.jp, color:C.ink, outline:"none", background:"#F7F2E8" }}
      />
    );
  }

  return (
    <Autocomplete
      onLoad={onLoad}
      onPlaceChanged={onPlaceChanged}
      options={{
        componentRestrictions: { country: "jp" },
        types,
      }}
    >
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder}
        style={{ width:"100%", padding:"7px 10px", borderRadius:9, border:`1px solid ${C.border}`,
          fontSize:12, fontFamily:font.jp, color:C.ink, outline:"none", background:"#F7F2E8" }}
      />
    </Autocomplete>
  );
}

/*
═══════════════════════════════════════════════════════════════
 tamawari.jsx（App.jsx）への組み込み方
═══════════════════════════════════════════════════════════════

このファイルを Vite プロジェクトの src/ に置き、App.jsx の先頭で import します:

    import { RealMapView, RealStoreMap, PlacesSearchInput } from "./GoogleMaps";

【1】フィードのマップビューを差し替え
  FeedScreen 内の「{view==="map" && (...)}」のダミー地図ブロックを、
  次の1行に置き換える:

    {view==="map" && <RealMapView listings={filtered} onSelect={onSelect} />}

  ※ API接続時、listing は store_lat / store_lng を持っています。

【2】募集詳細の地図を差し替え
  DetailScreen 内の「<div className="map-mock">...</div>」を:

    <RealStoreMap lat={listing.store_lat} lng={listing.store_lng} storeName={listing.store} />

【3】投稿フォームのスーパー検索を差し替え
  PostScreen のスーパー入力欄を PlacesSearchInput に置き換え、
  選択時に store / lat / lng をstateに保存する:

    <PlacesSearchInput onSelect={(p) => {
      setSelectedStore({ name:p.name });
      setStore(p.name);
      // p.lat, p.lng を投稿時に store_lat/store_lng として送る
    }} />

  そして handleSubmit / handlePost で、ハードコードしていた
  store_lat:35.6598, store_lng:139.7008 を、選択した p.lat / p.lng に変更する。

═══════════════════════════════════════════════════════════════
*/
