const form = document.getElementById("login-form");
const errorEl = document.getElementById("login-error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  const password = document.getElementById("password").value;

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || "Login gagal.";
      errorEl.hidden = false;
      return;
    }
    window.location.href = "/";
  } catch (err) {
    errorEl.textContent = "Tidak bisa menghubungi server.";
    errorEl.hidden = false;
  }
});
