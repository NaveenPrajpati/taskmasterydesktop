// The update card (updater.ts sends its state)
const title = document.getElementById('title');
const body = document.getElementById('body');
const bar = document.getElementById('bar');
const fill = document.getElementById('fill');

function render(state) {
  let progress = null;
  switch (state.phase) {
    case 'downloading':
      title.textContent = 'Updating Tazor';
      body.textContent = `Downloading version ${state.version} · ${state.percent}%`;
      progress = state.percent;
      break;
    case 'ready':
      title.textContent = 'Update ready';
      body.textContent = `Restarting in ${state.seconds} s to finish updating.`;
      progress = 100;
      break;
    case 'waiting':
      title.textContent = 'Update ready';
      body.textContent = 'Restarts to finish after your call or audio ends.';
      progress = 100;
      break;
    case 'restarting':
      title.textContent = 'Restarting Tazor…';
      body.textContent = `Installing version ${state.version}.`;
      progress = 100;
      break;
    case 'updated':
      title.textContent = 'Tazor was updated';
      body.textContent = `You're now on version ${state.version}.`;
      break;
    case 'latest':
      title.textContent = "You're up to date";
      body.textContent = `Tazor ${state.version} is the latest version.`;
      break;
    case 'failed':
      title.textContent = "Couldn't update Tazor";
      body.textContent = "Check your connection. We'll try again later.";
      break;
  }
  // Full text for screen readers and the tooltip, even when it's cut off
  body.title = body.textContent;
  bar.hidden = progress === null;
  if (progress !== null) fill.style.width = `${progress}%`;
}

window.updateCard.onState(render);
