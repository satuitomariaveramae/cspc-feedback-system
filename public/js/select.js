/* Custom dropdown that enhances every ".select select" on the public pages.
   The native <select> stays in the form (hidden), so validation, drafts and
   submission keep working. If this script fails, the native select is used. */
(function () {
  'use strict';
  var CHECK = '<svg class="cs-check" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var uid = 0;
  var instances = [];

  function build(wrap) {
    var select = wrap.querySelector('select');
    if (!select || wrap.classList.contains('cs')) return;
    var id = 'cs' + (++uid);
    var placeholder = '';
    var items = [];
    Array.prototype.forEach.call(select.options, function (o) {
      if (o.disabled && !o.value) { placeholder = o.textContent; return; }
      items.push({ value: o.value, label: o.textContent });
    });

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', id);
    var lab = document.querySelector('label[for="' + select.id + '"]');
    if (lab) { if (!lab.id) lab.id = id + '-label'; trigger.setAttribute('aria-labelledby', lab.id); }
    if (!lab && select.getAttribute('aria-label')) trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
    var text = document.createElement('span');
    text.className = 'cs-text';
    trigger.appendChild(text);

    var list = document.createElement('ul');
    list.className = 'cs-list';
    list.id = id;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    var opts = items.map(function (it) {
      var li = document.createElement('li');
      li.className = 'cs-opt';
      li.setAttribute('role', 'option');
      li.dataset.value = it.value;
      li.innerHTML = '<span></span>' + CHECK;
      li.firstChild.textContent = it.label;
      list.appendChild(li);
      return li;
    });

    wrap.classList.add('cs');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    wrap.insertBefore(trigger, select.nextSibling);
    wrap.appendChild(list);

    var active = -1;
    function selectedIndex() {
      for (var i = 0; i < items.length; i++) if (items[i].value === select.value) return i;
      return -1;
    }
    function sync() {
      var i = selectedIndex();
      text.textContent = i >= 0 ? items[i].label : placeholder;
      trigger.classList.toggle('is-placeholder', i < 0);
      opts.forEach(function (li, n) { li.setAttribute('aria-selected', n === i ? 'true' : 'false'); });
      trigger.classList.toggle('is-invalid', select.classList.contains('is-invalid'));
    }
    function setActive(n, scroll) {
      active = n;
      opts.forEach(function (li, i) { li.classList.toggle('is-active', i === n); });
      if (n >= 0) {
        trigger.setAttribute('aria-activedescendant', id + '-o' + n);
        if (scroll !== false) opts[n].scrollIntoView({ block: 'nearest' });
      } else trigger.removeAttribute('aria-activedescendant');
    }
    function open() {
      instances.forEach(function (x) { if (x !== api) x.close(); });
      list.hidden = false; wrap.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      var i = selectedIndex();
      setActive(i >= 0 ? i : 0);
    }
    function close() {
      list.hidden = true; wrap.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      setActive(-1, false);
    }
    function choose(n) {
      select.value = items[n].value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync(); close(); trigger.focus();
    }
    opts.forEach(function (li, n) {
      li.id = id + '-o' + n;
      li.addEventListener('mousedown', function (e) { e.preventDefault(); });
      li.addEventListener('click', function () { choose(n); });
      li.addEventListener('mousemove', function () { if (active !== n) setActive(n, false); });
    });
    trigger.addEventListener('click', function () { list.hidden ? open() : close(); });
    trigger.addEventListener('keydown', function (e) {
      var isOpen = !list.hidden;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) return open();
        setActive(Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))));
      } else if (e.key === 'Home' && isOpen) { e.preventDefault(); setActive(0); }
      else if (e.key === 'End' && isOpen) { e.preventDefault(); setActive(items.length - 1); }
      else if ((e.key === 'Enter' || e.key === ' ') && isOpen) { e.preventDefault(); if (active >= 0) choose(active); }
      else if (e.key === 'Escape' && isOpen) { e.preventDefault(); close(); }
      else if (e.key === 'Tab' && isOpen) close();
    });
    // Validation calls select.focus(): hand it to the visible control.
    select.addEventListener('focus', function () { trigger.focus(); });
    select.addEventListener('change', sync);
    new MutationObserver(sync).observe(select, { attributes: true, attributeFilter: ['class'] });
    if (select.form) select.form.addEventListener('reset', function () { setTimeout(sync, 0); });

    var api = { close: close, sync: sync };
    instances.push(api);
    sync();
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('.select'), build);
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.select.cs')) instances.forEach(function (x) { x.close(); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
