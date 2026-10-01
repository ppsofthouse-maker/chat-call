import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDJuTBDZvJ8QpmmRamVb_w-q4vP5Wutlz4",
  authDomain: "voice-chat-pro-36550.firebaseapp.com",
  projectId: "voice-chat-pro-36550",
  storageBucket: "voice-chat-pro-36550.firebasestorage.app",
  messagingSenderId: "1060789296680",
  appId: "1:1060789296680:web:758c308883631bfc5a9f1d",
  measurementId: "G-65BD3Z9VLV"
};

const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);

const $ = id => document.getElementById(id); 
let currentUser = null, currentChat = null, currentUnsub = null, peerConnection = null, localStream = null;
let isRegisterMode = false;

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const toast = m => { const t = $("toast"); if(!t) return; t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2500); };
const normPhone = p => { p = (p || "").replace(/[^\d+]/g, ""); if(p.startsWith("00")) p = "+" + p.slice(2); if(!p.startsWith("+")) p = "+" + p; return p; };
const initials = n => (n || "?").trim().slice(0, 1).toUpperCase();
const chatId = (a, b) => [a, b].sort().join("_").replace(/[^a-zA-Z0-9_:-]/g, "_");

function showModal(id) { const el = $(id); if(el) el.classList.remove("hidden"); }
function closeModal(id) { const el = $(id); if(el) el.classList.add("hidden"); }
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => closeModal(b.dataset.close));

$("switchAuthModeBtn").onclick = () => {
  isRegisterMode = !isRegisterMode;
  if(isRegisterMode){
    $("authModeTitle").textContent = "Naya account banayein (Email & Password)";
    $("phoneFieldBox").classList.remove("hidden");
    $("authActionBtn").textContent = "Register";
    $("switchAuthModeBtn").textContent = "Pehle se account hai? Login karein";
  } else {
    $("authModeTitle").textContent = "Apne Email & Password se Login karein";
    $("phoneFieldBox").classList.add("hidden");
    $("authActionBtn").textContent = "Login";
    $("switchAuthModeBtn").textContent = "Account nahi hai? Register karein";
  }
};

$("authActionBtn").onclick = async () => {
  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value.trim();
  const statusEl = $("authStatus");
  if(!email || !password) return statusEl.textContent = "Email aur Password lazmi hain.";
  
  try {
    if(isRegisterMode){
      const phone = normPhone($("regPhoneInput").value);
      const name = $("regNameInput").value.trim() || "User";
      if(phone.length < 10) return statusEl.textContent = "Sahi phone number enter karein.";
      
      const res = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(res.user, { displayName: name });
      await ensureUser(res.user, phone, name);
      statusEl.textContent = "Registration successful!";
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      statusEl.textContent = "Login successful.";
    }
  } catch(e) {
    statusEl.textContent = e.message;
  }
};

$("logoutBtn").onclick = () => signOut(auth);

async function ensureUser(u, customPhone = "", customName = "") {
  try {
    const r = doc(db, "users", u.uid);
    const s = await getDoc(r);
    const existing = s.exists() ? s.data() : {};
    const phone = customPhone || existing.phone || "";
    const name = customName || u.displayName || existing.name || "User";
    
    const data = { uid: u.uid, email: u.email, phone, name, updatedAt: serverTimestamp() };
    if(!s.exists()) data.createdAt = serverTimestamp();
    await setDoc(r, data, { merge: true });
    
    if(phone){
      await setDoc(doc(db, "phoneIndex", encodeURIComponent(phone)), { uid: u.uid, phone }, { merge: true });
    }
  } catch(err) {
    console.error("ensureUser error:", err);
  }
}

onAuthStateChanged(auth, async u => {
  currentUser = u;
  if(u){
    await ensureUser(u);
    let userData = {};
    try {
      const userDoc = await getDoc(doc(db, "users", u.uid));
      if(userDoc.exists()) userData = userDoc.data();
    } catch(err){}
    
    $("loginScreen").classList.add("hidden");
    $("appScreen").classList.remove("hidden");
    $("myNumber").textContent = userData.phone || "No phone added";
    $("myName").textContent = userData.name || u.displayName || "My Profile";
    $("myAvatar").textContent = initials(userData.name || u.displayName);
  } else {
    $("appScreen").classList.add("hidden");
    $("loginScreen").classList.remove("hidden");
  }
});

async function lookupPhone(phone) {
  const ref = await getDoc(doc(db, "phoneIndex", encodeURIComponent(normPhone(phone))));
  if(!ref.exists()) return null;
  const uid = ref.data().uid;
  const u = await getDoc(doc(db, "users", uid));
  return u.exists() ? u.data() : null;
}

async function openDirectChat(other) {
  if(!currentUser){
    toast("Pehle login karein!");
    return;
  }
  
  const cId = chatId(currentUser.uid, other.uid);
  currentChat = { id: cId, type: "direct", other };
  
  // Firestore rules ke mutabiq conversation document create/ensure karte hain
  try {
    const convRef = doc(db, "conversations", cId);
    const convSnap = await getDoc(convRef);
    if (!convSnap.exists()) {
      await setDoc(convRef, {
        members: [currentUser.uid, other.uid],
        createdAt: serverTimestamp()
      });
    }
  } catch(e) {
    console.error("Conversation setup error:", e);
  }
  
  $("homePanel").classList.remove("active-panel");
  $("homePanel").classList.add("hidden");
  $("listPanel").classList.add("hidden");
  $("chat").classList.remove("hidden");
  
  const o = currentChat.other || {};
  $("chatName").textContent = o.name || o.phone || "Contact";
  $("chatAvatar").textContent = initials(o.name || o.phone);
  $("chatStatus").textContent = "Online (In-App)";
  
  listenMessages();
}

function listenMessages() {
  if(currentUnsub) currentUnsub();
  const box = $("messages");
  box.innerHTML = "";
  
  const qRef = query(collection(db, "conversations", currentChat.id, "messages"), orderBy("createdAt", "asc"));
  currentUnsub = onSnapshot(qRef, snap => {
    box.innerHTML = "";
    if(snap.empty){
      box.innerHTML = `<div class="p-4 text-center text-gray-500">Abhi koi message nahi hai. Pehla message bhejein!</div>`;
      return;
    }
    snap.forEach(docSnap => {
      const m = docSnap.data();
      const div = document.createElement("div");
      const isMe = m.senderId === currentUser.uid;
      div.className = `message ${isMe ? "sent" : "received"} p-2 my-1 rounded max-w-xs ${isMe ? "ml-auto bg-green-100 text-right" : "mr-auto bg-gray-100 text-left"}`;
      div.textContent = m.text;
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  });
}

$("sendBtn").onclick = sendText;
$("messageInput").onkeydown = e => { if(e.key === "Enter") sendText(); };

async function sendText() {
  const text = $("messageInput").value.trim();
  if(!currentChat){
    toast("Pehle koi chat open karein!");
    return;
  }
  if(!text) return;
  $("messageInput").value = "";
  
  try {
    // Firestore rules require senderId matching request.auth.uid
    await addDoc(collection(db, "conversations", currentChat.id, "messages"), {
      text,
      senderId: currentUser.uid,
      createdAt: serverTimestamp()
    });
  } catch(e) {
    toast("Message send nahi ho saka: " + e.message);
    console.error("Send error:", e);
  }
}

$("addNumberBtn").onclick = $("startChatBtn").onclick = () => showModal("numberModal");

$("createChat").onclick = async () => {
  const phone = normPhone($("numberInput").value);
  const nameInput = $("nameInput") ? $("nameInput").value.trim() : "";
  const st = $("numberStatus");
  
  if(!phone || phone.length < 10){
    st.textContent = "Sahi phone number enter karein (+92 ke sath).";
    return;
  }
  
  st.textContent = "Setting up chat...";
  let foundUser = await lookupPhone(phone);
  
  closeModal("numberModal");
  st.textContent = "";
  
  if(foundUser){
    openDirectChat(foundUser);
  } else {
    const generatedUid = "user_" + phone.replace(/\+/g, "");
    openDirectChat({ 
      uid: generatedUid, 
      phone: phone, 
      name: nameInput || phone 
    });
  }
};

$("backBtn").onclick = () => { 
  if(currentUnsub) currentUnsub();
  $("chat").classList.add("hidden"); 
  $("homePanel").classList.remove("hidden"); 
};

$("profileBtn").onclick = () => toast("Profile settings.");

$("callBtn").onclick = async () => {
  try {
    toast("Connecting WebRTC Voice Call...");
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    peerConnection = new RTCPeerConnection(rtcConfig);
    
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    
    peerConnection.ontrack = event => {
      const audio = new Audio();
      audio.srcObject = event.streams[0];
      audio.autoplay = true;
    };
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    await addDoc(collection(db, "calls"), {
      caller: currentUser.uid,
      receiver: currentChat.other.uid,
      offer: { type: offer.type, sdp: offer.sdp },
      createdAt: serverTimestamp()
    });
    
    toast("Call connected! Samne wale ki response ka intezar hai...");
  } catch(e) {
    toast("Call error: " + e.message);
  }
};

$("micBtn").onclick = () => toast("Voice messaging feature app ke andar active hai.");
$("emojiBtn").onclick = () => { $("messageInput").value += "🙂"; $("messageInput").focus(); };