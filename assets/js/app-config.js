const isLiveServerLocal =
  window.location.origin.includes("127.0.0.1:5500") ||
  window.location.origin.includes("localhost:5500");

window.HWF_APP_CONFIG = {
  apiBase: isLiveServerLocal ? "http://127.0.0.1:8787" : window.location.origin
};
