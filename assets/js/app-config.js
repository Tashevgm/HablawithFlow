const isLiveServerLocal =
  window.location.origin.includes("127.0.0.1:5500") ||
  window.location.origin.includes("localhost:5500");

const isLocalBackendOrigin =
  window.location.origin.includes("127.0.0.1:8787") ||
  window.location.origin.includes("localhost:8787");

const isHablawithflowPublicDomain =
  window.location.hostname === "hablawithflow.com" ||
  window.location.hostname === "www.hablawithflow.com";

window.HWF_APP_CONFIG = {
  apiBase: isLiveServerLocal
    ? "http://127.0.0.1:8787"
    : isLocalBackendOrigin
      ? window.location.origin
      : isHablawithflowPublicDomain
        ? "https://hablawithflow-api.onrender.com"
        : window.location.origin,
  lessonPrice: 20,
  currency: "GBP"
};
