// 오프라인 실행용 서비스워커 — 앱 파일은 '인터넷 먼저, 안 되면 저장본', Firebase 라이브러리는 '저장본 먼저'
// ※ 파일 구성(목록)이 바뀔 때만 CACHE 번호를 올리면 됨. 내용 수정은 인터넷 먼저 방식이라 다음 실행 때 자동 반영
const CACHE = "calendar-v1";
const SHELL = [
  "./", "./index.html", "./style.css", "./app.js", "./store.js", "./firebase-config.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Firebase 라이브러리(버전 고정 주소) → 저장본 먼저
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // 우리 앱 파일 → 인터넷 먼저, 실패하면 저장본
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("./index.html"))));
  }
  // 그 밖(Firestore·로그인 통신)은 건드리지 않음
});
