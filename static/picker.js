// Screen-share picker (screen-picker.ts opens it; picker-preload.ts bridges)
let sources = [];
let kind = 'screen';
let selected = null;

const grid = document.getElementById('sources');
const shareButton = document.getElementById('share');

function render() {
  grid.replaceChildren();
  const shown = sources.filter(s => s.kind === kind);
  if (!shown.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = kind === 'screen' ? 'No screens found.' : 'No windows to share.';
    grid.append(empty);
  }
  for (const source of shown) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source';
    button.setAttribute('aria-pressed', String(source.id === selected));
    const img = document.createElement('img');
    img.src = source.thumbnail;
    img.alt = '';
    const name = document.createElement('span');
    name.textContent = source.name;
    button.append(img, name);
    button.addEventListener('click', () => {
      selected = source.id;
      render();
    });
    button.addEventListener('dblclick', () => window.picker.choose(source.id));
    grid.append(button);
  }
  shareButton.disabled = !selected;
}

for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener('click', () => {
    kind = tab.dataset.kind;
    for (const t of document.querySelectorAll('[role="tab"]')) {
      t.setAttribute('aria-selected', String(t === tab));
    }
    render();
  });
}

shareButton.addEventListener('click', () => window.picker.choose(selected));
document.getElementById('cancel').addEventListener('click', () => window.picker.choose(null));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.picker.choose(null);
});

window.picker.onSources(list => {
  sources = list;
  // One screen: pre-select it
  const screens = list.filter(s => s.kind === 'screen');
  if (screens.length === 1) selected = screens[0].id;
  render();
});
