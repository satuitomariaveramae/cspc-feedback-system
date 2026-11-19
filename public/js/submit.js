(function () {
  'use strict';
  var form = document.getElementById('feedbackForm');
  if (!form) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var DRAFT_KEY = 'cspc_feedback_draft_v1';

  // ---------- Toast ----------
  var toast = $('#toast'), toastTimer;
  function showToast(msg) {
    toast.textContent = msg; toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2600);
  }

  // ---------- Anonymous toggle ----------
  var anon = $('#is_anonymous'), identity = $('#identityFields');
  function syncAnon() {
    var on = anon.checked;
    identity.hidden = on;
    $$('input', identity).forEach(function (i) { i.disabled = on; if (on) clearError(i); });
  }
  anon.addEventListener('change', syncAnon);

  // ---------- Character counter ----------
  var msg = $('#message'), count = $('#charCount');
  function syncCount() { count.textContent = msg.value.length; }
  msg.addEventListener('input', syncCount);

  // ---------- Star rating ----------
  var LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  var starInputs = $$('#stars input'), starLabels = $$('#stars .star'), hint = $('#starHint');
  function paintStars(n) { starLabels.forEach(function (l, i) { l.classList.toggle('on', i < n); }); }
  function checkedStar() { var c = $('#stars input:checked'); return c ? parseInt(c.value, 10) : 0; }
  function syncStars() {
    var n = checkedStar();
    paintStars(n);
    hint.textContent = n ? n + ' out of 5 \u2014 ' + LABELS[n] : 'Click a star to rate';
  }
  starLabels.forEach(function (label, i) {
    label.addEventListener('mouseenter', function () { paintStars(i + 1); });
    label.addEventListener('click', function (e) {
      var input = starInputs[i];
      if (input.checked) { e.preventDefault(); input.checked = false; syncStars(); } // click again to clear
    });
  });
  $('#stars').addEventListener('mouseleave', function () { paintStars(checkedStar()); });
  starInputs.forEach(function (i) { i.addEventListener('change', syncStars); });

  // ---------- Inline validation ----------
  function errEl(input) {
    var field = input.closest('.field');
    return field ? $('.field-error', field) : null;
  }
  function setError(input, text) {
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    var e = errEl(input);
    if (e) { e.textContent = text; e.hidden = false; }
  }
  function clearError(input) {
    input.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
    var e = errEl(input);
    if (e) e.hidden = true;
  }
  $$('input, select, textarea', form).forEach(function (el) {
    var ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, function () { clearError(el); });
  });

  var RULES = [
    ['full_name', 'Please enter your full name.', true],
    ['email', 'Please enter your email address.', true],
    ['college', 'Please select your college or department.', false],
    ['category', 'Please choose a category.', false],
    ['subject', 'Please add a short subject.', false],
    ['message', 'Please write your feedback.', false]
  ];
  form.addEventListener('submit', function (e) {
    var firstBad = null;
    RULES.forEach(function (r) {
      var el = document.getElementById(r[0]);
      if (r[2] && anon.checked) return;
      var v = (el.value || '').trim();
      var text = null;
      if (!v) text = r[1];
      else if (r[0] === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) text = 'Please enter a valid email address.';
      if (text) { setError(el, text); if (!firstBad) firstBad = el; }
    });
    if (firstBad) {
      e.preventDefault();
      firstBad.focus({ preventScroll: true });
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
    var btn = $('.btn-primary', form);
    btn.disabled = true; // prevent double-submit
  });

  // ---------- Save / restore draft (stored only in this browser) ----------
  var FIELDS = ['full_name', 'student_id', 'email', 'college', 'category', 'subject', 'message'];
  function collect() {
    var d = { is_anonymous: anon.checked, feedback_type: ($('input[name="feedback_type"]:checked') || {}).value, rating: checkedStar() };
    FIELDS.forEach(function (f) { d[f] = document.getElementById(f).value; });
    return d;
  }
  function apply(d) {
    FIELDS.forEach(function (f) { if (d[f] != null) document.getElementById(f).value = d[f]; });
    anon.checked = !!d.is_anonymous;
    if (d.feedback_type) { var t = $('input[name="feedback_type"][value="' + d.feedback_type + '"]'); if (t) t.checked = true; }
    if (d.rating) { var s = document.getElementById('star_' + d.rating); if (s) s.checked = true; }
    syncAnon(); syncCount(); syncStars();
  }
  $('#saveDraft').addEventListener('click', function () {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collect())); showToast('Draft saved on this device'); }
    catch (_) { showToast('Could not save draft in this browser'); }
  });
  var notice = $('#draftNotice');
  try {
    var saved = localStorage.getItem(DRAFT_KEY);
    if (saved) { apply(JSON.parse(saved)); notice.hidden = false; }
  } catch (_) {}
  $('#discardDraft').addEventListener('click', function () {
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
    form.reset(); syncAnon(); syncCount(); syncStars();
    notice.hidden = true;
    showToast('Draft discarded');
  });

  syncAnon(); syncCount(); syncStars();
})();
