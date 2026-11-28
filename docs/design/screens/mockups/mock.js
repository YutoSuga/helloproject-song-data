const params = new URLSearchParams(location.search);
const tabs = Array.from(document.querySelectorAll('[role="tab"]'));

function selectTab(selected) {
  tabs.forEach(tab => {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  });
}

if (tabs.length) {
  selectTab(tabs.find(tab => tab.getAttribute('aria-controls') === params.get('tab')) ?? tabs[0]);
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      const destination = {
        Home: 0,
        End: tabs.length - 1,
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length
      }[event.key];
      if (destination === undefined) return;
      event.preventDefault();
      selectTab(tabs[destination]);
      tabs[destination].focus();
    });
  });
}

for (const example of document.querySelectorAll('[data-example]')) {
  example.hidden = example.dataset.example !== (params.get('example') === 'single' ? 'single' : 'multiple');
}

for (const button of document.querySelectorAll('[data-dialog]')) {
  const dialog = document.getElementById(button.dataset.dialog);
  button.addEventListener('click', () => {
    dialog.showModal();
    dialog.addEventListener('close', () => button.focus(), { once: true });
  });
}
