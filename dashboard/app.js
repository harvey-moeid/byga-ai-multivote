document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
});

document.getElementById("analyze-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("result");
  resultEl.textContent = "Menjalankan analisis...";
  try {
    const res = await fetch("/api/analyze", { method: "POST" });
    const data = await res.json();
    resultEl.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    resultEl.textContent = "Gagal: " + err.message;
  }
});
