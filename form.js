import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// CONFIG FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyDHDnVQCO-s1G4CUOSaj0VlHxKpKs-3Sno",
  authDomain: "unveil-f8832.firebaseapp.com",
  databaseURL: "https://unveil-f8832-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "unveil-f8832",
  storageBucket: "unveil-f8832.firebasestorage.app",
  messagingSenderId: "378367302142",
  appId: "1:378367302142:web:c993cb575bc9a2463d08af",
  measurementId: "G-CSCZLEGNMS"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

const scriptURL = "https://script.google.com/macros/s/AKfycbyrkKZhXMMbfa3TlfmjOdnjUo7ZJ7O7H23gMwDuxj-3csa7A10QZzbuv4im_nBbd0l0/exec";

const LOCK_MS = 5 * 60 * 1000;

// AMBIL DATA DARI LOCALSTORAGE
const selectedSeats = JSON.parse(localStorage.getItem("selectedSeats")) || [];
const lockTime      = parseInt(localStorage.getItem("lockTime") || "0");

// Cek sesi: kalau lockTime sudah lewat dari 5 menit, langsung redirect
if (!selectedSeats.length || (Date.now() - lockTime) >= LOCK_MS) {
  alert("Sesi pemilihan kursi sudah habis atau tidak valid. Silakan pilih kursi ulang.");
  window.location.href = "index.html";
}

// CEK VIP
function isVIP(seat) {
  return ["A","B","C","D","E"].includes(seat.charAt(0));
}

const vip    = selectedSeats.filter(isVIP);
const reg    = selectedSeats.filter(s => !isVIP(s));
const vipTotal = vip.length * 40000;
const regTotal = reg.length * 35000;
const total    = vipTotal + regTotal;

// TAMPILKAN DETAIL KURSI
const seatDetailEl = document.getElementById("seatDetail");
const totalEl      = document.getElementById("total");

if (seatDetailEl) {
  seatDetailEl.innerHTML = "";

  if (vip.length) {
    const tagWrap = document.createElement("div");
    tagWrap.style.cssText = "margin-bottom:8px;";
    tagWrap.innerHTML = '<span style="font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:var(--gold);display:block;margin-bottom:6px;">VIP × ' + vip.length + ' — Rp ' + vipTotal.toLocaleString() + '</span>';
    const tags = document.createElement("div");
    tags.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
    vip.forEach(s => {
      const t = document.createElement("div");
      t.className = "seat-tag"; t.textContent = s;
      tags.appendChild(t);
    });
    tagWrap.appendChild(tags);
    seatDetailEl.appendChild(tagWrap);
  }

  if (reg.length) {
    const tagWrap = document.createElement("div");
    tagWrap.innerHTML = '<span style="font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:6px;">Reguler × ' + reg.length + ' — Rp ' + regTotal.toLocaleString() + '</span>';
    const tags = document.createElement("div");
    tags.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
    reg.forEach(s => {
      const t = document.createElement("div");
      t.className = "seat-tag"; t.textContent = s;
      t.style.background = "var(--blue-accent)"; t.style.color = "var(--white)";
      tags.appendChild(t);
    });
    tagWrap.appendChild(tags);
    seatDetailEl.appendChild(tagWrap);
  }
}

if (totalEl) {
  totalEl.textContent = "Rp " + total.toLocaleString("id-ID");
}

// UNLOCK: lepas lock semua kursi sesi ini di Firestore
async function unlockMySeats() {
  await Promise.all(selectedSeats.map(id => deleteDoc(doc(db, "seatLocks", id))));
}

// COUNTDOWN TIMER
const TIMER_EL = document.getElementById("countdown-timer");
const TIMER_BAR = document.getElementById("countdown-bar");
const TIMER_MSG = document.getElementById("countdown-msg");

let countdownInterval;

function startCountdown() {
  function tick() {
    const elapsed = Date.now() - lockTime;
    const remaining = Math.max(0, LOCK_MS - elapsed);
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const pct  = (remaining / LOCK_MS) * 100;

    if (TIMER_EL)  TIMER_EL.textContent  = mins + ":" + String(secs).padStart(2, "0");
    if (TIMER_BAR) TIMER_BAR.style.width = pct + "%";

    // Warna bar berubah saat mendekati habis
    if (TIMER_BAR) {
      if (pct > 40) TIMER_BAR.style.background = "var(--gold)";
      else if (pct > 15) TIMER_BAR.style.background = "#e07b1a";
      else TIMER_BAR.style.background = "#ef4444";
    }

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      if (TIMER_MSG) TIMER_MSG.textContent = "Waktu habis! Kursi dilepas.";
      unlockMySeats().then(() => {
        localStorage.removeItem("selectedSeats");
        localStorage.removeItem("lockTime");
        localStorage.removeItem("lockSession");
        setTimeout(() => { window.location.href = "index.html"; }, 2000);
      });
    }
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

startCountdown();

// SUBMIT
document.getElementById("submitBtn").onclick = async () => {
  const name  = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const file  = document.getElementById("bukti").files[0];

  // Cek waktu masih valid
  if ((Date.now() - lockTime) >= LOCK_MS) {
    alert("Waktu habis! Silakan pilih kursi ulang.");
    window.location.href = "index.html";
    return;
  }

  if (!name || !email || !phone || !file) {
    alert("Lengkapi semua data!");
    return;
  }

  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = true;
  const btnLabel = document.getElementById("btnLabel");
  if (btnLabel) btnLabel.textContent = "Memproses...";

  const reader = new FileReader();
  reader.onload = async function () {
    const base64 = reader.result;
    try {
      // 1. Simpan booking permanen ke Firestore
      await addDoc(collection(db, "bookings"), {
        name, email, phone,
        seats: selectedSeats,
        total,
        time: new Date()
      });

      // 2. Hapus lock (kursi sudah di-booking permanent)
      await unlockMySeats();

      // 3. Kirim ke Google Sheets
      await fetch(scriptURL, {
        method: "POST",
        body: JSON.stringify({ name, email, phone, seats: selectedSeats.join(", "), total, image: base64 })
      });

      clearInterval(countdownInterval);
      localStorage.removeItem("selectedSeats");
      localStorage.removeItem("lockTime");
      localStorage.removeItem("lockSession");

      // Tampilkan overlay sukses
      const ovName = document.getElementById("ovName");
      const ovSeats = document.getElementById("ovSeats");
      if (ovName) ovName.textContent = name;
      if (ovSeats) {
        ovSeats.innerHTML = "";
        selectedSeats.forEach(s => {
          const t = document.createElement("div");
          t.className = "seat-tag"; t.textContent = s;
          ovSeats.appendChild(t);
        });
      }
      const overlay = document.getElementById("overlay");
      if (overlay) overlay.classList.add("show");

    } catch (err) {
      console.error("ERROR:", err);
      alert("Error: " + err.message);
      if (btnLabel) btnLabel.textContent = "Konfirmasi Pesanan";
      submitBtn.disabled = false;
    }
  };
  reader.readAsDataURL(file);
};