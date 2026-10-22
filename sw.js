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
const NET_WAIT = 2500;                                    // 서버 응답을 기다리는 한도 (밀리초)
// 정해진 시간 안에 대답이 없으면 실패로 처리한다 (매달림 방지)
function timeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("네트워크 응답 없음")), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, err => { clearTimeout(t); reject(err); });
  });
}
// 저장본으로 띄운 뒤, 조용히 최신본을 받아 캐시에 넣어 둔다 (다음 실행 때 반영)
function refreshLater(req) {
  fetch(req).then(res => { if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())); }).catch(() => {});
}

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
  // cache:"no-cache" = 브라우저 캐시를 건너뛰지 않되 매번 서버에 "바뀌었나" 확인.
  //   이게 없으면 파일을 새로 올려도 캐시 유효시간(10분 내외) 동안 옛 파일이 나와,
  //   index.html만 새것이고 app.js·style.css는 옛것인 어긋난 상태가 생긴다. (26.10.20 실제 발생)
  //   안 바뀐 파일은 304로 끝나므로 트래픽 부담도 거의 없다.
  //   ※ PC 부팅 직후처럼 '연결된 것 같은데 실제로는 아직 안 되는' 상태에서는
  //      fetch가 실패하지 않고 그냥 매달린다. 그러면 app.js가 영영 안 와서
  //      화면이 껍데기만(년월·날짜칸 없이) 뜨고 멈춘다. (26.10.23 실제 발생)
  //      그래서 2.5초 안에 대답이 없으면 저장본으로 넘어간다.
  if (url.origin === self.location.origin) {
    e.respondWith(
      timeout(fetch(req, { cache: "no-cache" }), NET_WAIT).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => {
        refreshLater(req);                                  // 저장본으로 띄우고 최신본은 뒤에서 받아 둔다
        return caches.match(req, { ignoreSearch: true })
          .then(hit => hit || fetch(req).catch(() => caches.match("./index.html")));
      })
    );
  }
  // 그 밖(Firestore·로그인 통신)은 건드리지 않음
});
