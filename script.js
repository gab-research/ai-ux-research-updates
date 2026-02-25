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

  function getMonthKey(isoDate) {
    if (!isoDate || isoDate.length < 7) return '';
    return isoDate.slice(0, 7);
  }

  function formatMonthLabel(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function renderUpdate(update) {
    const card = document.createElement('article');
    card.className = 'update-card';
    card.setAttribute('aria-label', update.title);
    const monthKey = getMonthKey(update.date);
    if (monthKey) card.setAttribute('data-month', monthKey);

    const hasContent = typeof update.content === 'string' && update.content.trim().length > 0;
    const analysisText = typeof update.analysis === 'string' ? update.analysis.trim() : '';
    const hasAnalysis = analysisText.length > 0;
    const hasFullSection = hasContent || hasAnalysis;

    let inner =
      '<div class="update-meta">' +
        '<span class="update-date">' + formatHtml(update.date, formatDate) + '</span>' +
        '<span class="update-category">' + escapeHtml(update.category) + '</span>' +
      '</div>' +
      '<h3 class="update-title">' + escapeHtml(update.title) + '</h3>' +
      '<p class="update-summary">' + escapeHtml(update.summary) + '</p>';

    if (hasFullSection) {
      const id = 'content-' + update.date.replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 9);
      let fullContentHtml =
        '<div class="update-full-content" id="' + id + '" hidden>';
      if (hasContent) {
        fullContentHtml += '<div class="update-content-body">' + escapeHtml(update.content) + '</div>';
      }
      if (hasAnalysis) {
        fullContentHtml +=
          '<div class="update-analysis">' +
            '<h4 class="update-analysis-title">How to use at Nubank</h4>' +
            '<div class="update-analysis-body">' + escapeHtml(analysisText) + '</div>' +
          '</div>';
      }
      fullContentHtml += '</div>';
      inner += fullContentHtml + '<button type="button" class="update-toggle" aria-expanded="false" aria-controls="' + id + '">Read full content</button>';
    }

    inner += renderSource(update.source);
    card.innerHTML = inner;

    if (hasFullSection) {
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

  function buildSidebar(updates) {
    const sidebarEl = document.getElementById('sidebar');
    const navEl = document.getElementById('sidebar-nav');
    if (!sidebarEl || !navEl) return;

    var monthCounts = {};
    updates.forEach(function (u) {
      var key = getMonthKey(u.date);
      if (key) monthCounts[key] = (monthCounts[key] || 0) + 1;
    });
    var months = Object.keys(monthCounts).sort().reverse();

    var html = '<button type="button" class="sidebar-link is-active" data-month="">All</button>';
    months.forEach(function (key) {
      html += '<button type="button" class="sidebar-link" data-month="' + escapeAttr(key) + '">' + escapeHtml(formatMonthLabel(key)) + ' <span class="count">(' + monthCounts[key] + ')</span></button>';
    });
    navEl.innerHTML = html;

    navEl.querySelectorAll('.sidebar-link').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var month = btn.getAttribute('data-month') || '';
        navEl.querySelectorAll('.sidebar-link').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        feedEl.querySelectorAll('.update-card').forEach(function (card) {
          var cardMonth = card.getAttribute('data-month') || '';
          card.hidden = month !== '' && cardMonth !== month;
        });
      });
    });

    sidebarEl.hidden = false;
  }

  fetch('updates.json?t=' + Date.now(), { cache: 'no-store' })
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
      buildSidebar(updates);
    })
    .catch(function () {
      showError('Updates could not be loaded. Make sure updates.json exists and is valid.');
    });
})();
