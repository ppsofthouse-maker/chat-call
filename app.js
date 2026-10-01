import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, where, getDocs } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDJuTBDZvJ8QpmmRamVb_w-q4vP5Wutlz4",
  authDomain: "voice-chat-pro-36550.firebaseapp.com",
  projectId: "voice-chat-pro-36550",
  storageBucket: "voice-chat-pro-36550.firebasestorage.app",
  messagingSenderId: "1060789296680",
  appId: "1:1060789296680:web:758c308883631bfc5a9f1d",
  measurementId: "G-65BD3Z9VLV"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const $ = id => document.getElementById(id); 
let currentUser = null, currentChat = null, currentUnsub = null, callsUnsub = null;
let peerConnection = null, localStream = null, mediaRecorder = null, audioChunks = [];
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
    
    loadSavedContacts();
    listenIncomingCalls();
  } else {
    if(callsUnsub) callsUnsub();
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

async function saveContactToLocalList(other) {
  if(!currentUser || !other || !other.uid) return;
  try {
    await setDoc(doc(db, "users", currentUser.uid, "savedContacts", other.uid), {
      uid: other.uid,
      name: other.name || other.phone || "Contact",
      phone: other.phone || "",
      updatedAt: serverTimestamp()
    }, { merge: true });
    loadSavedContacts();
  } catch(e) {
    console.error("Save contact error:", e);
  }
}

async function loadSavedContacts() {
  if(!currentUser) return;
  try {
    const contactsRef = collection(db, "users", currentUser.uid, "savedContacts");
    const snap = await getDocs(contactsRef);
    
    // Hamari HTML ke mutabiq main content area ya home panel mein list show karte hain
    let homePanel = $("homePanel");
    if(!homePanel) return;
    
    let listContainer = $("savedContactsList");
    if(!listContainer){
      listContainer = document.createElement("div");
      listContainer.id = "savedContactsList";
      listContainer.className = "mt-4 p-4 max-w-lg mx-auto";
      homePanel.appendChild(listContainer);
    }
    
    listContainer.innerHTML = `<h3 class="font-bold text-lg text-gray-700 mb-3">Aapke Saved Contacts</h3>`;
    if(snap.empty){
      listContainer.innerHTML += `<p class="text-sm text-gray-400">Abhi koi contact save nahi hai. Nayi chat shuru karne ke liye niche wale button par click karein.</p>`;
      return;
    }
    
    snap.forEach(docSnap => {
      const contact = docSnap.data();
      const item = document.createElement("div");
      item.className = "flex items-center justify-between p-3 bg-white rounded-lg shadow mb-2 cursor-pointer hover:bg-gray-50 border";
      item.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-green-600 text-white flex items-center justify-center font-bold">${initials(contact.name)}</div>
          <div>
            <div class="font-semibold text-gray-800">${contact.name}</div>
            <div class="text-xs text-gray-500">${contact.phone}</div>
          </div>
        </div>
        <span class="text-xs px-3 py-1 bg-green-100 text-green-700 rounded-full font-medium">Chat Karein</span>
      `;
      item.onclick = () => openDirectChat(contact);
      listContainer.appendChild(item);
    });
  } catch(e) {
    console.error("Load contacts error:", e);
  }
}

// Sidebar ke Contacts button par click event lagana
document.querySelectorAll(".sidebar-item, button").forEach(el => {
  if(el.textContent && el.textContent.includes("Contacts")){
    el.onclick = () => {
      $("chat").classList.add("hidden");
      $("homePanel").classList.remove("hidden");
      loadSavedContacts();
    };
  }
});

async function openDirectChat(other) {
  if(!currentUser){
    toast("Pehle login karein!");
    return;
  }
  
  await saveContactToLocalList(other);
  
  const cId = chatId(currentUser.uid, other.uid);
  currentChat = { id: cId, type: "direct", other };
  
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
  
  $("homePanel").classList.add("hidden");
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
      div.className = `bubble ${isMe ? "mine" : ""} my-1`;
      
      if(m.type === "audio"){
        div.innerHTML = `<div class="voice"><audio controls src="${m.audioUrl}"></audio></div><small>${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small>`;
      } else {
        div.innerHTML = `<div>${m.text}</div><small>${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small>`;
      }
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  });
}

$("sendBtn").onclick = sendText;
$("messageInput").onkeydown = e => { if(e.key === "Enter") sendText(); };

async function sendText() {
  const text = $("messageInput").value.trim();
  if(!currentChat || !text) return;
  $("messageInput").value = "";
  
  try {
    await addDoc(collection(db, "conversations", currentChat.id, "messages"), {
      text,
      type: "text",
      senderId: currentUser.uid,
      createdAt: serverTimestamp()
    });
  } catch(e) {
    toast("Message send nahi ho saka: " + e.message);
  }
}

$("micBtn").onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      toast("Voice message upload ho raha hai...");
      
      try {
        const fileRef = sRef(storage, `audio_messages/${currentChat.id}_${Date.now()}.webm`);
        await uploadBytes(fileRef, audioBlob);
        const downloadUrl = await getDownloadURL(fileRef);
        
        await addDoc(collection(db, "conversations", currentChat.id, "messages"), {
          audioUrl: downloadUrl,
          type: "audio",
          senderId: currentUser.uid,
          createdAt: serverTimestamp()
        });
        toast("Voice message sent!");
      } catch(e) {
        toast("Voice upload error: " + e.message);
      }
      stream.getTracks().forEach(t => t.stop());
    };
    
    mediaRecorder.start();
    $("recording").classList.remove("hidden");
    toast("Recording shuru ho chuki hai...");
  } catch(e) {
    toast("Microphone ki permission nahi mili.");
  }
};

$("stopRecord").onclick = () => {
  if(mediaRecorder && mediaRecorder.state !== "inactive"){
    mediaRecorder.stop();
    $("recording").classList.add("hidden");
  }
};

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
  loadSavedContacts();
};

$("profileBtn").onclick = () => toast("Profile settings.");

$("callBtn").onclick = async () => {
  if(!currentChat) return toast("Pehle chat open karein!");
  try {
    toast("Calling...");
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    peerConnection = new RTCPeerConnection(rtcConfig);
    
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    
    peerConnection.ontrack = event => {
      const audio = new Audio();
      audio.srcObject = event.streams[0];
      audio.autoplay = true;
    };
    
    const callDocRef = doc(collection(db, "calls"));
    
    peerConnection.onicecandidate = async event => {
      if(event.candidate){
        await addDoc(collection(db, "calls", callDocRef.id, "callerCandidates"), event.candidate.toJSON());
      }
    };
    
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    await setDoc(callDocRef, {
      caller: currentUser.uid,
      receiver: currentChat.other.uid,
      offer: { type: offer.type, sdp: offer.sdp },
      status: "ringing",
      createdAt: serverTimestamp()
    });
    
    onSnapshot(callDocRef, async snap => {
      const data = snap.data();
      if(data && data.answer && !peerConnection.currentRemoteDescription){
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        toast("Call connected!");
      }
    });
    
    const receiverCandidatesCol = collection(db, "calls", callDocRef.id, "receiverCandidates");
    onSnapshot(receiverCandidatesCol, snap => {
      snap.docChanges().forEach(async change => {
        if(change.type === "added"){
          await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        }
      });
    });

    toast("Ringing... samne wale ke jawab ka intezar hai.");
  } catch(e) {
    toast("Call error: " + e.message);
  }
};

function listenIncomingCalls() {
  if(!currentUser) return;
  const qRef = query(collection(db, "calls"), where("receiver", "==", currentUser.uid), where("status", "==", "ringing"));
  callsUnsub = onSnapshot(qRef, snap => {
    snap.forEach(async docSnap => {
      const callData = docSnap.data();
      const callId = docSnap.id;
      const accept = confirm("Incoming Voice Call! Kya aap receive karna chahte hain?");
      if(accept){
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          peerConnection = new RTCPeerConnection(rtcConfig);
          localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
          
          peerConnection.ontrack = event => {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.autoplay = true;
          };
          
          peerConnection.onicecandidate = async event => {
            if(event.candidate){
              await addDoc(collection(db, "calls", callId, "receiverCandidates"), event.candidate.toJSON());
            }
          };
          
          await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          
          await setDoc(doc(db, "calls", callId), { answer: { type: answer.type, sdp: answer.sdp }, status: "connected" }, { merge: true });
          
          const callerCandidatesCol = collection(db, "calls", callId, "callerCandidates");
          onSnapshot(callerCandidatesCol, snap => {
            snap.docChanges().forEach(async change => {
              if(change.type === "added"){
                await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
              }
            });
          });
          
          toast("Call connected!");
        } catch(e) {
          toast("Call connect error: " + e.message);
        }
      } else {
        await setDoc(doc(db, "calls", callId), { status: "rejected" }, { merge: true });
      }
    });
  });
}

$("emojiBtn").onclick = () => { $("messageInput").value += "🙂"; $("messageInput").focus(); };