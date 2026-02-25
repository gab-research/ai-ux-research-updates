(function () {
  const feedEl = document.getElementById('updates-feed');
  const loadingEl = document.getElementById('loading');

  function formatDate(isoDate) {
    const d = new Date(isoDate);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  function renderUpdate(update) {
    const card = document.createElement('article');
    card.className = 'update-card';
    card.setAttribute('aria-label', update.title);

    const hasContent = update.content && update.content.trim().length > 0;

    let inner =
      '<div class="update-meta">' +
        '<span class="update-date">' + formatHtml(update.date, formatDate) + '</span>' +
        '<span class="update-category">' + escapeHtml(update.category) + '</span>' +
      '</div>' +
      '<h3 class="update-title">' + escapeHtml(update.title) + '</h3>' +
      '<p class="update-summary">' + escapeHtml(update.summary) + '</p>';

    if (hasContent) {
      const id = 'content-' + update.date.replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 9);
      inner +=
        '<div class="update-full-content" id="' + id + '" hidden>' +
          '<div class="update-content-body">' + escapeHtml(update.content) + '</div>' +
        '</div>' +
        '<button type="button" class="update-toggle" aria-expanded="false" aria-controls="' + id + '">Read full content</button>';
    }

    inner += renderSource(update.source);
    card.innerHTML = inner;

    if (hasContent) {
      const btn = card.querySelector('.update-toggle');
      const contentEl = card.querySelector('.update-full-content');
      if (btn && contentEl) {
        btn.addEventListener('click', function () {
          const isOpen = !contentEl.hidden;
          contentEl.hidden = isOpen;
          btn.setAttribute('aria-expanded', !isOpen);
          btn.textContent = isOpen ? 'Read full content' : 'Show less';
        });
      }
    }
    return card;
  }

  function formatHtml(isoDate, formatter) {
    return escapeHtml(formatter(isoDate));
  }

  function renderSource(source) {
    if (!source) return '';
    const name = typeof source === 'string' ? source : (source.name || '');
    const url = typeof source === 'object' && source.url;
    if (!name && !url) return '';
    const label = name || (url ? 'Source' : '');
    if (url && label) {
      return '<p class="update-source">Source: <a href="' + escapeAttr(url) + '" class="update-source-link" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a></p>';
    }
    if (url) {
      return '<p class="update-source">Source: <a href="' + escapeAttr(url) + '" class="update-source-link" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a></p>';
    }
    return '<p class="update-source">Source: ' + escapeHtml(label) + '</p>';
  }

  function escapeAttr(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/"/g, '&quot;');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showError(message) {
    if (loadingEl) loadingEl.remove();
    feedEl.innerHTML = '<p class="error-message">' + escapeHtml(message) + '</p>';
  }

  fetch('updates.json')
    .then(function (res) {
      if (!res.ok) throw new Error('Could not load updates.');
      return res.json();
    })
    .then(function (data) {
      if (loadingEl) loadingEl.remove();
      const updates = data.updates || [];
      if (updates.length === 0) {
        feedEl.innerHTML = '<p class="loading">No updates yet. Add entries to updates.json to see them here.</p>';
        return;
      }
      updates.forEach(function (update) {
        feedEl.appendChild(renderUpdate(update));
      });
    })
    .catch(function () {
      showError('Updates could not be loaded. Make sure updates.json exists and is valid.');
    });
})();
