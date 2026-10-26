// Keep the deadline active until the complete response body has been read.
async function fetchJson(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { fetchJson };
