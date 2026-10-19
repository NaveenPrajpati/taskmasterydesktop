// Back to the page that failed (main.ts passes it as ?retry=), on click,
// when the connection returns, and every 15 seconds
const params = new URLSearchParams(location.search);
const retryUrl = params.get('retry');

// ?reason=slow: online, but the server didn't answer in time
if (params.get('reason') === 'slow') {
  document.getElementById('title').textContent = 'TaskMastery is taking too long';
  document.getElementById('message').textContent =
    "The server isn't responding. We'll keep trying.";
}

function retry() {
  if (retryUrl) location.href = retryUrl;
}

document.getElementById('retry').addEventListener('click', retry);
window.addEventListener('online', retry);
setInterval(() => {
  if (navigator.onLine) retry();
}, 15000);
