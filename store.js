// 저장소 계층 — 구글 로그인 + Firestore 저장·실시간 수신·동기화 상태 (화면 코드는 이 파일의 Store만 사용)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInWithCredential,
  onAuthStateChanged, signOut, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, query, where, documentId, onSnapshot, writeBatch, setDoc, serverTimestamp, waitForPendingWrites,
  addDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// 데이터 위치: 편한메모 데이터와 섞이지 않도록 별도 최상위 경로 사용
const ROOT = "calendarUsers";

/* ---------- 설정값 점검: 잘못되면 작업 전에 멈추고 이유를 알려줌 ---------- */
function checkConfig(c) {
  const need = ["apiKey", "authDomain", "projectId", "appId"];
  const bad = need.filter(k => typeof c?.[k] !== "string" || !c[k].trim() || c[k].includes("여기에"));
  return bad.length ? `firebase-config.js의 ${bad.join(", ")} 값이 비어 있어요. Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 값을 붙여넣어 주세요.` : "";
}
const configError = checkConfig(firebaseConfig);

let auth = null, db = null;
if (!configError) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // 오프라인에서도 저장 → 연결되면 자동 전송, 여러 창 동시 사용 가능
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  // 개발용: localhost에서 ?emulator 로 열면 로컬 테스트 서버 사용
  if (["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emulator")) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
}

/* ---------- 동기화 상태 ---------- */
let pending = 0, lastError = "";
const stateListeners = new Set();
function syncState() {
  if (lastError) return { code: "error", text: "⚠ " + lastError };
  if (!navigator.onLine) return { code: "offline", text: pending ? `오프라인 · 전송 대기 ${pending}건` : "오프라인 · 연결되면 자동 전송" };
  if (pending) return { code: "pending", text: "동기화 중…" };
  return { code: "synced", text: "동기화 완료" };
}
const emitState = () => stateListeners.forEach(cb => cb(syncState()));
window.addEventListener("online", emitState);
window.addEventListener("offline", emitState);

function track(promise) {                     // 서버가 받으면 완료 (오프라인이면 연결될 때까지 대기)
  pending++; lastError = ""; emitState();
  return promise
    .then(() => true)
    .catch(err => { lastError = errorText(err); return false; })
    .finally(() => { pending--; emitState(); });
}
function errorText(err) {
  const code = err?.code || "";
  if (code === "permission-denied") return "저장 권한이 없어요 (보안 규칙 확인 필요)";
  if (code === "unauthenticated") return "로그인이 필요해요";
  if (code === "resource-exhausted") return "오늘 무료 사용량을 초과했어요";
  return `저장 실패 (${code || err?.message || "알 수 없는 오류"})`;
}

let uid = null;
const userPath = (...p) => [ROOT, uid, ...p].join("/");

/* 메모는 편한메모 앱과 '같은 저장소'를 쓴다 (users/{uid}/memos).
   달력이 쓴 메모에는 date 항목("YYYY-MM-DD")이 붙고, 달력은 그 항목이 있는 메모만 읽는다.
   편한메모에서 만든 기존 메모는 date가 없어 달력에 나타나지 않는다.
   편한메모의 수정은 지정한 항목만 바꾸므로(text·pinned·updated), 거기서 글을 고쳐도 date는 그대로 남는다. */
const memoPath = (...p) => ["users", uid, "memos", ...p].join("/");

export const Store = {
  configError,

  /* 로그인 */
  onAuth(cb) {
    if (!auth) return;
    onAuthStateChanged(auth, user => { uid = user ? user.uid : null; lastError = ""; cb(user); emitState(); });
  },
  async signIn() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    // PC 앱(Electron)은 기본 브라우저 로그인 결과(idToken)를 넘겨줌 — 6단계에서 연결
    if (window.calendarDesktop?.googleSignIn) {
      const { idToken } = await window.calendarDesktop.googleSignIn();
      return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    }
    try {
      return await signInWithPopup(auth, provider);
    } catch (err) {
      // 팝업이 막히는 환경이면 페이지 이동 방식으로 재시도
      if (["auth/popup-blocked", "auth/operation-not-supported-in-environment"].includes(err.code)) {
        return signInWithRedirect(auth, provider);
      }
      throw err;
    }
  },
  signOut: () => signOut(auth),

  /* 실시간 수신 — 반환값은 구독 해제 함수 */
  watchDays(startKey, endKey, cb) {
    const q = query(collection(db, userPath("days")),
      where(documentId(), ">=", startKey), where(documentId(), "<=", endKey));
    return onSnapshot(q, snap => {
      const out = {};
      snap.forEach(d => { out[d.id] = d.data().items; });
      cb(out);
    }, err => { lastError = errorText(err); emitState(); });
  },
  watchSettings(cb) {
    return onSnapshot(doc(db, userPath("settings", "widget")), s => cb(s.exists() ? s.data() : {}),
      err => { lastError = errorText(err); emitState(); });
  },
  watchHolidays(cb) {                         // PC 앱이 저장한 연도별 공휴일
    return onSnapshot(collection(db, userPath("holidays")), snap => {
      const out = {};
      snap.forEach(d => { out[d.id] = d.data(); });
      cb(out);
    }, err => { lastError = errorText(err); emitState(); });
  },

  watchMemos(startKey, endKey, cb) {          // 보이는 기간의 '날짜가 붙은 메모'만
    const q = query(collection(db, memoPath()),
      where("date", ">=", startKey), where("date", "<=", endKey));
    return onSnapshot(q, snap => {
      const out = {};
      snap.forEach(d => {
        const x = d.data();
        if (typeof x.date === "string" && typeof x.text === "string") {
          out[x.date] = { id: d.id, text: x.text, created: x.created || 0, pinned: !!x.pinned };
        }
      });
      cb(out);
    }, err => { lastError = errorText(err); emitState(); });
  },

  /* 저장 — changes = { "YYYY-MM-DD": [항목] (빈 배열이면 삭제) }, 여러 날짜를 한 번에 */
  saveDays(changes) {
    const batch = writeBatch(db);
    for (const k in changes) {
      const ref = doc(db, userPath("days", k));
      if (changes[k].length) batch.set(ref, { items: changes[k], updatedAt: serverTimestamp() });
      else batch.delete(ref);
    }
    return track(batch.commit());
  },
  saveHolidays(year, days) {                  // PC 위젯이 받은 공휴일 저장
    return track(setDoc(doc(db, userPath("holidays", String(year))), { days, updatedAt: serverTimestamp() }));
  },
  /* 메모 저장 — id가 있으면 고치고, 없으면 새로 만든다.
     고칠 때 date는 건드리지 않는다 (편한메모에서 고쳐도 날짜가 유지되는 것과 같은 방식) */
  saveMemo(dateKey, text, id) {
    const now = Date.now();
    if (id) return track(updateDoc(doc(db, memoPath(id)), { text, updated: now }));
    return track(addDoc(collection(db, memoPath()), {
      text, pinned: false, created: now, updated: now, date: dateKey
    }));
  },
  deleteMemo(id) { return track(deleteDoc(doc(db, memoPath(id)))); },
  // 되돌리기 — 지운 메모를 원래 글·날짜·만든시각 그대로 되살린다 (문서 번호는 새로 생김)
  restoreMemo(m) {
    return track(addDoc(collection(db, memoPath()), {
      text: m.text, pinned: !!m.pinned, created: m.created || Date.now(),
      updated: Date.now(), date: m.date
    }));
  },

  saveSettings(s) {
    return track(setDoc(doc(db, userPath("settings", "widget")), { ...s, updatedAt: serverTimestamp() }));
  },

  /* 동기화 상태 */
  onSyncState(cb) { stateListeners.add(cb); cb(syncState()); },
  async syncNow() {
    lastError = ""; emitState();
    if (!navigator.onLine) return;
    await track(waitForPendingWrites(db));
  }
};
