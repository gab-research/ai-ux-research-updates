(function () {
  const feedEl = document.getElementById('updates-feed');
  const loadingEl = document.getElementById('loading');

  function formatDate(isoDate) {
    // Parse as local calendar date so "2025-02-25" shows as Feb 25 everywhere (avoid UTC midnight → previous day in some timezones)
    const parts = (isoDate || '').slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return isoDate || '';
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
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
    if (update.category) card.setAttribute('data-category', update.category);

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

  function getCurrentMonthKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }

  var activeThemeFilter = '';

  function clearThemeFilter() {
    activeThemeFilter = '';
    var listEl = document.getElementById('themes-list');
    if (listEl) {
      listEl.querySelectorAll('.theme-item').forEach(function (el) { el.classList.remove('is-active'); });
    }
  }

  function applyCardFilters() {
    var navEl = document.getElementById('sidebar-nav');
    var activeMonthBtn = navEl && navEl.querySelector('.sidebar-link.is-active');
    var monthFilter = activeMonthBtn ? (activeMonthBtn.getAttribute('data-month') || '') : '';

    feedEl.querySelectorAll('.update-card').forEach(function (card) {
      var matchesMonth = monthFilter === '' || card.getAttribute('data-month') === monthFilter;
      var matchesTheme = activeThemeFilter === '' || card.getAttribute('data-category') === activeThemeFilter;
      card.hidden = !(matchesMonth && matchesTheme);
    });
  }

  function renderThemesList(listEl, sorted, monthKey, formatMonthLabel) {
    if (!listEl) return;
    if (!sorted.length) {
      listEl.innerHTML = '';
      listEl.removeAttribute('role');
      return;
    }
    listEl.setAttribute('role', 'list');
    listEl.innerHTML = sorted.map(function (item, i) {
      var descHtml = item.description ? '<span class="theme-desc">' + escapeHtml(item.description) + '</span>' : '';
      return '<button type="button" class="theme-item" role="listitem" data-category="' + escapeAttr(item.name) + '">' +
        '<span class="theme-rank">' + (i + 1) + '</span>' +
        '<span class="theme-info"><span class="theme-name">' + escapeHtml(item.name) + '</span>' + descHtml + '</span>' +
        '<span class="theme-count">' + item.count + (item.count === 1 ? ' post' : ' posts') + '</span>' +
        '</button>';
    }).join('');

    listEl.querySelectorAll('.theme-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var category = btn.getAttribute('data-category') || '';
        var wasActive = btn.classList.contains('is-active');

        listEl.querySelectorAll('.theme-item').forEach(function (el) { el.classList.remove('is-active'); });

        if (wasActive) {
          activeThemeFilter = '';
        } else {
          btn.classList.add('is-active');
          activeThemeFilter = category;
        }
        applyCardFilters();
      });
    });
  }

  function showThemesSection(monthKey, sorted, updatedDate) {
    const sectionEl = document.getElementById('themes-section');
    const titleEl = document.getElementById('themes-title');
    const updatedEl = document.getElementById('themes-updated');
    const dateEl = document.getElementById('themes-date');
    const listEl = document.getElementById('themes-list');
    if (!sectionEl || !titleEl || !listEl) return;
    titleEl.textContent = 'Top 10 themes in AI in UX Research — ' + formatMonthLabel(monthKey);
    if (updatedEl) {
      updatedEl.textContent = 'Based on how often each theme appears in the sources this month.';
      updatedEl.style.display = '';
    }
    if (dateEl) {
      dateEl.textContent = updatedDate ? formatDate(updatedDate) : '';
      dateEl.style.display = updatedDate ? '' : 'none';
    }
    renderThemesList(listEl, sorted, monthKey, formatMonthLabel);
    sectionEl.hidden = false;
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
        navEl.querySelectorAll('.sidebar-link').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        applyCardFilters();
      });
    });

    sidebarEl.hidden = false;
  }

  var ts = '?t=' + Date.now();
  Promise.all([
    fetch('updates.json' + ts, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Could not load updates.')); }),
    fetch('themes.json' + ts, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (results) {
    var data = results[0];
    var themesData = results[1];
    if (loadingEl) loadingEl.remove();
    var updates = data.updates || [];
    if (updates.length === 0) {
      feedEl.innerHTML = '<p class="loading">No updates yet. Add entries to updates.json to see them here.</p>';
      return;
    }
    // Theme counts come only from themes.json (RSS sources this month). Never from the website's updates.
    if (themesData && themesData.themes && themesData.themes.length > 0) {
      showThemesSection(themesData.month || getCurrentMonthKey(), themesData.themes, themesData.updated || null);
    } else {
      showThemesSection(getCurrentMonthKey(), [], null);
      var updatedEl = document.getElementById('themes-updated');
      var dateEl = document.getElementById('themes-date');
      if (updatedEl) {
        updatedEl.textContent = 'Theme counts are updated daily from all RSS sources. Data will appear after the next run.';
        updatedEl.style.display = '';
      }
      if (dateEl) dateEl.style.display = 'none';
    }
    updates.forEach(function (update) {
      feedEl.appendChild(renderUpdate(update));
    });
    buildSidebar(updates);
  }).catch(function () {
    showError('Updates could not be loaded. Make sure updates.json exists and is valid.');
  });
})();
