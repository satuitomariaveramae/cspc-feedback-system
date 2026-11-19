$(function () {
  // ---------- Flash message auto-dismiss ----------
  $('.flash-close').on('click', function () {
    $(this).closest('.flash').fadeOut(200);
  });
  if ($('#flashMessage').length) {
    setTimeout(() => $('#flashMessage').fadeOut(400), 6000);
  }

  // ---------- OTP: six separate boxes ----------
  const $otp = $('.otp-box');
  if ($otp.length) {
    const $hidden = $('#code');
    const sync = () => $hidden.val($otp.map(function () { return this.value; }).get().join(''));
    const fill = (start, digits) => {
      digits.split('').forEach((d, k) => { if ($otp[start + k]) $otp[start + k].value = d; });
      $otp[Math.min(start + digits.length, $otp.length - 1)].focus();
      sync();
    };
    const $grp = $('#otpGroup');
    const clearOtpErr = () => { $grp.removeClass('has-error'); $('#otpError').prop('hidden', true); };
    if ($grp.hasClass('has-error')) $otp.last().focus();
    $otp.on('input', function () {
      clearOtpErr();
      const i = $otp.index(this);
      const digits = this.value.replace(/\D/g, '');
      this.value = '';
      if (!digits) return sync();
      fill(i, digits); // handles one digit, autofill, or multi-char input
    });
    $otp.on('keydown', function (e) {
      const i = $otp.index(this);
      if (e.key === 'Backspace' && !this.value && i > 0) {
        e.preventDefault();
        $otp[i - 1].value = '';
        $otp[i - 1].focus();
        sync();
      } else if (e.key === 'ArrowLeft' && i > 0) { $otp[i - 1].focus(); }
      else if (e.key === 'ArrowRight' && i < $otp.length - 1) { $otp[i + 1].focus(); }
    });
    $otp.on('focus', function () { this.select(); });
    $otp.on('paste', function (e) {
      const text = ((e.originalEvent || e).clipboardData.getData('text') || '').replace(/\D/g, '');
      if (!text) return;
      e.preventDefault();
      fill($otp.index(this), text.slice(0, $otp.length - $otp.index(this)));
    });
    $otp.on('keydown', function (e) { if (e.key === 'Backspace') clearOtpErr(); });
    $otp.closest('form').on('submit', function (e) {
      sync();
      if ($hidden.val().length < 6) {
        e.preventDefault();
        $('#otpError').text('Please enter the 6-digit verification code.').prop('hidden', false);
      }
    });
  }

  // ---------- Anonymous toggle: hide identity fields ----------
  const $anon = $('#is_anonymous');
  const $identityFields = $('#identityFields, #emailField');
  function toggleIdentity() {
    if ($anon.is(':checked')) {
      $identityFields.slideUp(150);
      $identityFields.find('input').prop('disabled', true);
    } else {
      $identityFields.slideDown(150);
      $identityFields.find('input').prop('disabled', false);
    }
  }
  if ($anon.length) {
    toggleIdentity();
    $anon.on('change', toggleIdentity);
  }

  // ---------- Character counter for message textarea ----------
  const $message = $('#message');
  const $charCount = $('#charCount');
  if ($message.length) {
    const updateCount = () => $charCount.text($message.val().length);
    updateCount();
    $message.on('input', updateCount);
  }

  // ---------- Feedback form client-side validation ----------
  $('#feedbackForm').on('submit', function (e) {
    let valid = true;
    $(this).find('[required]:visible').each(function () {
      if (!$(this).val()) {
        valid = false;
        $(this).css('border-color', '#e5484d');
      } else {
        $(this).css('border-color', '');
      }
    });
    if (!valid) {
      e.preventDefault();
    }
  });

  // ---------- jQuery UI: select styling fallback (native selects kept for a11y) ----------
  // Tooltips on star rating (jQuery UI tooltip widget) for extra polish
  if ($.fn.tooltip) {
    $('.rating label').tooltip({
      position: { my: 'center bottom-12', at: 'center top' }
    });
  }

  // ---------- Admin: delete confirmation via jQuery UI Dialog ----------
  const $deleteDialog = $('#deleteDialog');
  if ($deleteDialog.length && $.fn.dialog) {
    $deleteDialog.dialog({
      autoOpen: false,
      modal: true,
      resizable: false,
      width: 420,
      dialogClass: 'no-close-icon',
      buttons: {
        'Cancel': function () {
          $(this).dialog('close');
        },
        'Delete': function () {
          $('#deleteForm').trigger('submit');
        }
      }
    });

    $('#deleteBtn').on('click', function () {
      $deleteDialog.dialog('open');
    });
  }

  // ---------- Admin sidebar: highlight active on hash-free nav (already server rendered) ----------

  // ---------- Login v2: password show/hide toggle ----------
  $('#togglePassword').on('click', function () {
    const $pwd = $('#password');
    const isPwd = $pwd.attr('type') === 'password';
    $pwd.attr('type', isPwd ? 'text' : 'password');
    $(this).attr('aria-label', isPwd ? 'Hide password' : 'Show password')
           .attr('aria-pressed', isPwd ? 'true' : 'false')
           .toggleClass('is-visible', isPwd);
  });

  // ---------- Admin Login: Terms & Conditions modal ----------
  const $termsOverlay = $('#termsModalOverlay');
  if ($termsOverlay.length) {
    $('#openTermsModal').on('click', function (e) {
      e.preventDefault();
      $termsOverlay.addClass('open');
    });
    $('#closeTermsModal, #acceptTermsModal').on('click', function () {
      if (this.id === 'acceptTermsModal') {
        $('#terms_accepted').prop('checked', true);
      }
      $termsOverlay.removeClass('open');
    });
    $termsOverlay.on('click', function (e) {
      if (e.target === this) $termsOverlay.removeClass('open');
    });
  }

  // ---------- Inline (plain-text) field errors ----------
  const showErr = ($el, msg) => { $el.text(msg).prop('hidden', false); };
  const hideErr = ($el) => { $el.prop('hidden', true); };

  // ---------- Admin Login: inline validation ----------
  const $terms = $('#terms_accepted');
  if ($terms.length) {
    $terms.closest('form').on('submit', function (e) {
      let bad = false;
      if (!$.trim($('#username').val())) { showErr($('#err-username'), 'Please enter your email address.'); bad = true; }
      if (!$('#password').val()) { showErr($('#err-password'), 'Please enter your password.'); bad = true; }
      if (!$terms.is(':checked')) { showErr($('#err-terms'), 'You must agree to the Terms & Conditions before logging in.'); bad = true; }
      if (bad) e.preventDefault();
    });
    $('#username').on('input', () => hideErr($('#err-username')));
    $('#password').on('input', () => hideErr($('#err-password')));
    $terms.on('change', () => hideErr($('#err-terms')));
  }

  // ---------- Forgot password: inline domain validation ----------
  const $ident = $('#identifier');
  if ($ident.length) {
    $ident.closest('form').on('submit', function (e) {
      const v = $.trim($ident.val()).toLowerCase();
      if (!v) { e.preventDefault(); showErr($('#err-identifier'), 'Please enter your email address.'); }
      else if (!/^[^\s@]+@(my\.cspc\.edu\.ph|gmail\.com)$/.test(v)) { e.preventDefault(); showErr($('#err-identifier'), 'Please use your official CSPC email address.'); }
    });
    $ident.on('input', () => hideErr($('#err-identifier')));
  }


  // ---------- Verification code: resend with 60s cooldown ----------
  const $resendForm = $('#resendForm');
  if ($resendForm.length) {
    const $btn = $('#resendBtn');
    const $label = $('#resendLabel');
    let timer = null;
    const startCountdown = (secs) => {
      clearInterval(timer);
      let left = secs;
      const paint = () => $label.text('Resend code in ' + left + 's');
      $btn.prop('disabled', true);
      paint();
      timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          $btn.prop('disabled', false);
          $label.text('RESEND CODE');
        } else { paint(); }
      }, 1000);
    };
    const initial = parseInt($resendForm.data('cooldown'), 10) || 0;
    if (initial > 0) startCountdown(initial);

    $resendForm.on('submit', function (e) {
      e.preventDefault();
      if ($btn.prop('disabled')) return;
      $btn.prop('disabled', true);
      $.ajax({ url: '/admin/resend-code', method: 'POST', dataType: 'json' })
        .done(function (r) {
          // Fresh start: clear old digits and any red error state.
          $('.otp-box').val('');
          $('#code').val('');
          $('#otpGroup').removeClass('has-error');
          $('#otpError').prop('hidden', true);
          $('.otp-box').first().focus();
          $('#otpSuccess').text('A new verification code has been sent to your email address.').prop('hidden', false);
          startCountdown(r.cooldown || 60);
        })
        .fail(function (xhr) {
          const r = xhr.responseJSON || {};
          if (xhr.status === 429 && r.retryAfter) { startCountdown(r.retryAfter); return; }
          if (xhr.status === 401) { window.location.href = '/admin/forgot-password'; return; }
          $btn.prop('disabled', false);
          $('#otpSuccess').prop('hidden', true);
          $('#otpError').text(r.message || 'Something went wrong. Please try again.').prop('hidden', false);
        });
    });
    // Hide the confirmation once the user starts typing a new code.
    $('.otp-box').on('input', () => $('#otpSuccess').prop('hidden', true));
  }

  // ---------- Reset password: confirm-match live check ----------
  const $newPwd = $('#new_password');
  const $confirmPwd = $('#confirm_password');
  if ($newPwd.length && $confirmPwd.length) {
    const checkMatch = () => {
      if ($confirmPwd.val() && $newPwd.val() !== $confirmPwd.val()) {
        $confirmPwd.css('border-color', '#e5484d');
      } else {
        $confirmPwd.css('border-color', '');
      }
    };
    $newPwd.add($confirmPwd).on('input', checkMatch);
  }
});
