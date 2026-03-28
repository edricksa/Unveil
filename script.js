import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// Session ID unik per tab
const SESSION_ID = sessionStorage.getItem("sessionId") || (() => {
  const id = crypto.randomUUID();
  sessionStorage.setItem("sessionId", id);
  return id;
})();

const LOCK_MS = 5 * 60 * 1000;

const container = document.getElementById("seatContainer");
const info      = document.getElementById("info");
const bookBtn   = document.getElementById("bookBtn");

let selectedSeats = [];
let bookedSeats   = new Set();
let lockedSeats   = new Map(); // seatId -> { sessionId, lockedAt(ms) }

// ── Saat halaman dibuka: bersihkan lock lama milik sesi ini ──
// (kasus: user balik dari form.html tanpa submit)
async function releaseMyOldLocks() {
  const prevSession = sessionStorage.getItem("sessionId");
  if (!prevSession) return;
  // Lock yang ada di sessionStorage tapi user sudah balik ke sini = dibatalkan
  const prevSelected = JSON.parse(sessionStorage.getItem("pendingSeats") || "[]");
  if (prevSelected.length) {
    await Promise.all(prevSelected.map(id => {
      const ref = doc(db, "seatLocks", id);
      // Hanya hapus kalau memang milik sesi ini (dicek di applyStatuses juga)
      return deleteDoc(ref).catch(() => {});
    }));
    sessionStorage.removeItem("pendingSeats");
  }
}

releaseMyOldLocks();

// ── Buat elemen kursi ──
function createSeat(id) {
  const seat = document.createElement("div");
  seat.classList.add("seat");
  seat.innerText = id;
  seat.dataset.seat = id;

  seat.onclick = () => {
    if (seat.classList.contains("booked")) return;
    if (seat.classList.contains("locked")) return;

    const wasSelected = seat.classList.contains("selected");
    seat.classList.toggle("selected");

    if (wasSelected) {
      selectedSeats = selectedSeats.filter(s => s !== id);
    } else {
      selectedSeats.push(id);
    }

    info.innerText = selectedSeats.length
      ? "Kursi: " + selectedSeats.join(", ")
      : "Belum pilih kursi";
  };

  return seat;
}

// ── Generate layout ──
const tiers = [
  { name: "FIRST CLASS", rows: ["A","B","C"] },
  { name: "BUSINESS", rows: ["D","E","F","G"] },
  { name: "ECONOMY", rows: ["H","I","J","K","L","M","N","O"] }
];

const cols = 5;

tiers.forEach((tier, tierIndex) => {

  // 🔥 LABEL TIER
  const label = document.createElement("div");
  label.className = "divider";
  label.innerText = tier.name;
  container.appendChild(label);

  // 🔥 ROWS
  tier.rows.forEach(row => {
    const rowDiv = document.createElement("div");
    rowDiv.classList.add("row");

    // kiri
    for (let i = 1; i <= cols; i++) {
      rowDiv.appendChild(createSeat(row + i));
    }

    // aisle tengah
    const aisle = document.createElement("div");
    aisle.classList.add("aisle");
    rowDiv.appendChild(aisle);

    // kanan
    for (let i = cols + 1; i <= cols * 2; i++) {
      rowDiv.appendChild(createSeat(row + i));
    }

    container.appendChild(rowDiv);
  });

});
// ── Apply status visual ke semua kursi ──
function applyStatuses() {
  const now = Date.now();
  document.querySelectorAll(".seat").forEach(seatEl => {
    const id = seatEl.dataset.seat;
    seatEl.classList.remove("booked", "locked");

    if (bookedSeats.has(id)) {
      seatEl.classList.add("booked");
      seatEl.classList.remove("selected");
      selectedSeats = selectedSeats.filter(s => s !== id);
      return;
    }

    if (lockedSeats.has(id)) {
      const lock = lockedSeats.get(id);
      const expired = (now - lock.lockedAt) > LOCK_MS;
      if (!expired && lock.sessionId !== SESSION_ID) {
        seatEl.classList.add("locked");
        seatEl.classList.remove("selected");
        selectedSeats = selectedSeats.filter(s => s !== id);
      }
    }
  });

  info.innerText = selectedSeats.length
    ? "Kursi: " + selectedSeats.join(", ")
    : "Belum pilih kursi";
}

// ── Listener: bookings permanent ──
onSnapshot(collection(db, "bookings"), (snapshot) => {
  bookedSeats.clear();
  snapshot.forEach(d => (d.data().seats || []).forEach(s => bookedSeats.add(s)));
  applyStatuses();
});

// ── Listener: seat locks realtime ──
onSnapshot(collection(db, "seatLocks"), (snapshot) => {
  lockedSeats.clear();
  const now = Date.now();
  snapshot.forEach(d => {
    const data     = d.data();
    const lockedAt = typeof data.lockedAt === "number" ? data.lockedAt : data.lockedAt?.toMillis?.() ?? 0;
    if (lockedAt && (now - lockedAt) <= LOCK_MS) {
      lockedSeats.set(d.id, { sessionId: data.sessionId, lockedAt });
    }
  });
  applyStatuses();
});

// ── Lock semua kursi sekaligus pakai writeBatch ──
// writeBatch = satu atomic write, semua masuk atau tidak sama sekali
async function lockSeats(seats) {
  const batch = writeBatch(db);
  const now   = Date.now(); // pakai client timestamp agar konsisten
  seats.forEach(id => {
    batch.set(doc(db, "seatLocks", id), {
      sessionId: SESSION_ID,
      lockedAt:  now
    });
  });
  await batch.commit(); // satu commit = semua kursi terkunci bersamaan
}

// ── Unlock kursi (pakai batch juga) ──
async function unlockSeats(seats) {
  if (!seats.length) return;
  const batch = writeBatch(db);
  seats.forEach(id => batch.delete(doc(db, "seatLocks", id)));
  await batch.commit();
}

// ── Unlock saat user menutup/refresh tab ──
// pakai pagehide + sendBeacon agar lebih andal dari beforeunload
window.addEventListener("pagehide", () => {
  const mine = [...lockedSeats.entries()]
    .filter(([, v]) => v.sessionId === SESSION_ID)
    .map(([k]) => k)
    .filter(id => !JSON.parse(localStorage.getItem("selectedSeats") || "[]").includes(id));
  // Hanya lepas kursi yang TIDAK sedang dalam proses checkout (belum ke form.html)
  if (mine.length) unlockSeats(mine);
});

// ── Tombol Pesan ──
bookBtn.onclick = async () => {
  if (selectedSeats.length === 0) {
    alert("Pilih kursi terlebih dahulu!");
    return;
  }

  // Cek konflik terakhir sebelum lock
  const conflicted = selectedSeats.filter(s =>
    bookedSeats.has(s) ||
    (lockedSeats.has(s) && lockedSeats.get(s).sessionId !== SESSION_ID)
  );

  if (conflicted.length) {
    alert("Kursi " + conflicted.join(", ") + " sudah diambil orang lain. Pilih kursi lain ya!");
    conflicted.forEach(s => {
      const el = document.querySelector('[data-seat="' + s + '"]');
      if (el) el.classList.remove("selected");
    });
    selectedSeats = selectedSeats.filter(s => !conflicted.includes(s));
    info.innerText = selectedSeats.length
      ? "Kursi: " + selectedSeats.join(", ")
      : "Belum pilih kursi";
    return;
  }

  bookBtn.disabled = true;
  bookBtn.textContent = "Mengunci kursi...";

  try {
    await lockSeats(selectedSeats); // atomic batch write

    // Simpan ke localStorage untuk form.html
    localStorage.setItem("selectedSeats", JSON.stringify(selectedSeats));
    localStorage.setItem("lockTime",      Date.now().toString());
    localStorage.setItem("lockSession",   SESSION_ID);

    // Simpan juga ke sessionStorage buat cleanup kalau user balik tanpa submit
    sessionStorage.setItem("pendingSeats", JSON.stringify(selectedSeats));

    window.location.href = "form.html";
  } catch (err) {
    console.error(err);
    alert("Gagal mengunci kursi, coba lagi.");
    bookBtn.disabled  = false;
    bookBtn.textContent = "Lanjut Pesan";
  }
};