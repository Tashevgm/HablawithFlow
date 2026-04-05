const isLocalHost =
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "localhost";

const isLiveServerLocal = isLocalHost && window.location.port !== "8787";

const isLocalBackendOrigin = isLocalHost && window.location.port === "8787";

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
