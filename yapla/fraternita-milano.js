(function () {
    try {
        if (window.sessionStorage && window.sessionStorage.getItem('frat_payment_loader_pending') === '1') {
            document.documentElement.classList.add('frat-payment-nav-pending');
        }
    } catch (_error) {
    }
})();

(function () {
    var PREFILL_VALUES = {
        fiscalcode: "RSSMRA80A01F205X",
        address_street: "abc",
        address_city: "abc",
        address_zip: "10100",
        billing_address: "abc",
        billing_city: "abc",
        billing_zip: "10100",
        billing_country: "IT"
    };
    var TIP_DEFAULT = 1.4;
    var currentTipAmount = TIP_DEFAULT;
    var currentStepIndex = 0;
    var tipManuallyEdited = false;
    var donationRefreshTimer = null;
    var lastValidationSignature = "";
    var nativeLineNode = null;
    var nativeMountNode = null;
    var nativeMountParentNode = null;
    var nativeMountNextSiblingNode = null;
    var nativeSlotNode = null;
    var nativeSlotHostNode = null;
    var shellLineNode = null;
    var isSubmitting = false;
    var loaderStartedAt = Date.now();
    var INITIAL_LOADER_MIN_MS = 1200;
    var initialLoaderPending = true;
    var LOADER_SESSION_KEY = 'frat_payment_loader_pending';
    var navigationTransitionPending = false;
    var transitionOverlayNode = null;
    var pageFullyLoaded = document.readyState === 'complete';
    var suppressCustomAmountBlurRefresh = false;
    var FORM_CACHE_KEY = getFormCacheKey();
    var pendingReturnToStepThree = false;

    function readSessionFlag(key) {
        try {
            return window.sessionStorage ? window.sessionStorage.getItem(key) : null;
        } catch (_error) {
            return null;
        }
    }

    function writeSessionFlag(key, value) {
        try {
            if (!window.sessionStorage) return;
            if (value == null) {
                window.sessionStorage.removeItem(key);
                return;
            }
            window.sessionStorage.setItem(key, String(value));
        } catch (_error) {
        }
    }

    function getFormCacheKey() {
        var path = window.location.pathname || 'unknown-form';
        return 'frat_donation_form_cache:' + path;
    }

    function readFormCache() {
        try {
            if (!window.localStorage) return null;
            var raw = window.localStorage.getItem(FORM_CACHE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_error) {
            return null;
        }
    }

    function writeFormCache(payload) {
        try {
            if (!window.localStorage) return;
            window.localStorage.setItem(FORM_CACHE_KEY, JSON.stringify(payload));
        } catch (_error) {
        }
    }

    function buildFormCachePayload() {
        var fixedChoice = query('#frat-app #frat-donation_choice_id-0');
        var customChoice = query('#frat-app #frat-donation_choice_id-1');
        var customAmount = query('#frat-app #frat-custom_amount');
        var first = query('#frat-app #frat-firstname');
        var last = query('#frat-app #frat-lastname');
        var email = query('#frat-app #frat-email');

        return {
            donation_choice: fixedChoice && fixedChoice.checked ? 'fixed' : (customChoice && customChoice.checked ? 'custom' : ''),
            custom_amount: customAmount ? customAmount.value : '',
            firstname: first ? first.value : '',
            lastname: last ? last.value : '',
            email: email ? email.value : '',
            tip_amount: currentTipAmount,
            tip_manually_edited: tipManuallyEdited
        };
    }

    function persistFormCache() {
        writeFormCache(buildFormCachePayload());
    }

    function restoreFormCache() {
        var cached = readFormCache();
        var fixedChoice = query('#frat-app #frat-donation_choice_id-0');
        var otherChoice = query('#frat-app #frat-donation_choice_id-1');
        var customAmount = query('#frat-app #frat-custom_amount');
        var first = query('#frat-app #frat-firstname');
        var last = query('#frat-app #frat-lastname');
        var email = query('#frat-app #frat-email');

        if (!cached) {
            return;
        }

        if (first && typeof cached.firstname === 'string') first.value = cached.firstname;
        if (last && typeof cached.lastname === 'string') last.value = cached.lastname;
        if (email && typeof cached.email === 'string') email.value = cached.email;
        if (customAmount && typeof cached.custom_amount === 'string') customAmount.value = cached.custom_amount;

        if (fixedChoice) {
            fixedChoice.checked = cached.donation_choice === 'fixed';
            fixedChoice.toggleAttribute('checked', fixedChoice.checked);
        }

        if (otherChoice) {
            otherChoice.checked = cached.donation_choice === 'custom';
            otherChoice.toggleAttribute('checked', otherChoice.checked);
        }

        if (typeof cached.tip_amount === 'number' && isFinite(cached.tip_amount)) {
            currentTipAmount = cached.tip_amount;
        }

        tipManuallyEdited = cached.tip_manually_edited === true;
    }

    function getLoader() {
        return query('#frat-loader');
    }

    function ensureTransitionOverlay() {
        if (transitionOverlayNode && transitionOverlayNode.parentNode) {
            return transitionOverlayNode;
        }

        transitionOverlayNode = document.createElement('div');
        transitionOverlayNode.id = 'frat-payment-transition-overlay';
        transitionOverlayNode.className = 'frat-payment-transition-overlay';
        transitionOverlayNode.innerHTML = '<div class="frat-payment-transition-overlay__spinner" aria-hidden="true"></div>';
        document.body.appendChild(transitionOverlayNode);
        return transitionOverlayNode;
    }

    function showTransitionOverlay() {
        var overlay = ensureTransitionOverlay();
        if (!overlay) return;

        document.body.classList.add('frat-force-payment-overlay');
        overlay.classList.add('is-visible');
    }

    function hideTransitionOverlay() {
        var overlay = transitionOverlayNode;
        document.body.classList.remove('frat-force-payment-overlay');
        if (!overlay) return;
        overlay.classList.remove('is-visible');
    }

    function setNavigationTransitionState(isPending) {
        document.documentElement.classList.toggle('frat-payment-nav-pending', Boolean(isPending));
    }

    function beginPaymentLoaderTransition() {
        navigationTransitionPending = true;
        writeSessionFlag(LOADER_SESSION_KEY, '1');
        setNavigationTransitionState(true);
        showTransitionOverlay();
        showBrandedLoader('compact');
    }

    function clearPaymentLoaderTransition() {
        navigationTransitionPending = false;
        writeSessionFlag(LOADER_SESSION_KEY, null);
        setNavigationTransitionState(false);
        hideTransitionOverlay();
    }

    function setLoaderMode(mode) {
        var loader = getLoader();
        if (!loader) return;

        loader.classList.toggle('frat-loader--initial', mode === 'initial');
        loader.classList.toggle('frat-loader--compact', mode === 'compact');
    }

    function setInitialLoadingState(isLoading) {
        if (!document.body) return;
        document.body.classList.toggle('frat-is-loading', isLoading);
        document.body.classList.toggle('frat-ready', !isLoading);
    }

    function showBrandedLoader(mode) {
        var loader = getLoader();
        if (!loader) return;

        setLoaderMode(mode || (initialLoaderPending ? 'initial' : 'compact'));
        loader.classList.remove('is-hidden');
    }

    function hideBrandedLoader() {
        var loader = getLoader();
        if (!loader) return;

        loader.classList.add('is-hidden');
    }

    function hideInitialLoader() {
        var loader = getLoader();
        if (!loader || !initialLoaderPending) return;
        var elapsed = Date.now() - loaderStartedAt;
        var delay = Math.max(0, INITIAL_LOADER_MIN_MS - elapsed);
        initialLoaderPending = false;

        window.setTimeout(function () {
            setLoaderMode('compact');
            hideBrandedLoader();
        }, delay);
    }

    function patchYaplaLoader() {
        if (!window.HPJUtils || window.HPJUtils.__fratLoaderPatched === true) {
            return;
        }

        window.HPJUtils.__fratLoaderPatched = true;

        var originalShowSpinner = typeof window.HPJUtils.showSpinner === "function"
            ? window.HPJUtils.showSpinner.bind(window.HPJUtils)
            : null;
        var originalDisplay = typeof window.HPJUtils.displayLoadingBox === "function"
            ? window.HPJUtils.displayLoadingBox.bind(window.HPJUtils)
            : null;
        var originalHide = typeof window.HPJUtils.hideLoadingBox === "function"
            ? window.HPJUtils.hideLoadingBox.bind(window.HPJUtils)
            : null;

        window.HPJUtils.showSpinner = function () {
            if (navigationTransitionPending || readSessionFlag(LOADER_SESSION_KEY) === '1') {
                return;
            }

            if (originalShowSpinner) {
                originalShowSpinner.apply(null, arguments);
            }
        };

        window.HPJUtils.displayLoadingBox = function () {
            if (originalHide) {
                originalHide();
            }
            showBrandedLoader();
        };

        window.HPJUtils.hideLoadingBox = function () {
            if (originalHide) {
                originalHide.apply(null, arguments);
            }
            if (navigationTransitionPending || readSessionFlag(LOADER_SESSION_KEY) === '1') {
                return;
            }
            if (initialLoaderPending) {
                hideInitialLoader();
                return;
            }
            hideBrandedLoader();
        };
    }

    if (document.body) {
        setInitialLoadingState(true);
    } else {
        document.addEventListener("DOMContentLoaded", function markLoading() {
            setInitialLoadingState(true);
        }, { once: true });
    }

    if (readSessionFlag(LOADER_SESSION_KEY) === '1') {
        navigationTransitionPending = true;
        initialLoaderPending = false;
        setNavigationTransitionState(true);
    }

    window.addEventListener('load', function () {
        pageFullyLoaded = true;
        maybeHidePaymentLoader();
    });

    window.addEventListener('beforeunload', function () {
        if (!navigationTransitionPending && readSessionFlag(LOADER_SESSION_KEY) !== '1') {
            return;
        }

        setNavigationTransitionState(true);
    });

    function onReady(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn, { once: true });
        } else {
            fn();
        }
    }

    function query(selector, root) {
        return (root || document).querySelector(selector);
    }

    function queryAll(selector, root) {
        return Array.from((root || document).querySelectorAll(selector));
    }

    function findNativeLine(appRoot) {
        var candidates = queryAll('.line.site_line__item').filter(function (line) {
            return !(appRoot && line.contains(appRoot));
        });

        return candidates.find(function (line) {
            return Boolean(
                query('.single-page-donation-wrapper', line) ||
                query('.form-receiptView', line) ||
                query('#payment-form-stripe', line) ||
                query('[data-component="stripe-payment"]', line) ||
                query('#js-payment-check', line) ||
                query('#fieldset-ThanksPart', line) ||
                query('.zone-donation', line)
            );
        }) || null;
    }

    function findNativeMountNode(line) {
        if (!line) return null;

        return query('.zone-donation', line) ||
            query('.single-page-donation-wrapper', line) ||
            query('.form-receiptView', line) ||
            query('.don-form-wrapper', line) ||
            query('.container', line);
    }

    function ensureNativeSlot() {
        var flow = query('#frat-app .frat-flow');
        if (!flow) return;

        if (!nativeSlotNode) {
            nativeSlotNode = document.createElement('section');
            nativeSlotNode.id = 'frat-native-slot';
            nativeSlotNode.className = 'frat-card frat-native-slot';
            nativeSlotNode.innerHTML = '<div id="frat-native-slot-host" class="frat-native-slot__host"></div>';
            flow.appendChild(nativeSlotNode);
            nativeSlotHostNode = query('#frat-native-slot-host', nativeSlotNode);
        } else if (!nativeSlotNode.parentNode) {
            flow.appendChild(nativeSlotNode);
        }

        if (!nativeSlotHostNode) {
            nativeSlotHostNode = query('#frat-native-slot-host', nativeSlotNode);
        }
    }

    function moveNativeMountIntoSlot() {
        if (!nativeMountNode) return;
        ensureNativeSlot();
        if (!nativeSlotHostNode) return;

        if (!nativeMountParentNode) {
            nativeMountParentNode = nativeMountNode.parentNode;
            nativeMountNextSiblingNode = nativeMountNode.nextSibling;
        }

        if (nativeMountNode.parentNode !== nativeSlotHostNode) {
            nativeSlotHostNode.appendChild(nativeMountNode);
        }
    }

    function restoreNativeMount() {
        if (!nativeMountNode || !nativeMountParentNode) return;

        if (nativeMountNextSiblingNode && nativeMountNextSiblingNode.parentNode === nativeMountParentNode) {
            nativeMountParentNode.insertBefore(nativeMountNode, nativeMountNextSiblingNode);
        } else {
            nativeMountParentNode.appendChild(nativeMountNode);
        }
    }

    function setupDomAnchors() {
        var appRoot = query('#frat-app');

        document.body.classList.add('frat-donation-page');

        shellLineNode = shellLineNode || (appRoot ? appRoot.closest('.line.site_line__item') : null);
        nativeLineNode = nativeLineNode || findNativeLine(appRoot);
        nativeMountNode = nativeMountNode || findNativeMountNode(nativeLineNode);

        if (shellLineNode) {
            shellLineNode.classList.add('frat-shell-line');
        }

        if (nativeLineNode) {
            nativeLineNode.classList.add('frat-native-line');
        }

        ensureNativeSlot();
    }

    function getNativeLine() {
        return nativeLineNode;
    }

    function nativeQuery(selector) {
        var root = nativeMountNode || getNativeLine();
        return root ? query(selector, root) : null;
    }

    function nativeQueryAll(selector) {
        var root = nativeMountNode || getNativeLine();
        return root ? queryAll(selector, root) : [];
    }

    function getStepPanels() {
        return queryAll('#frat-app [data-step-panel]');
    }

    function setActiveStep(index, options) {
        var config = options || {};
        var panels = getStepPanels();

        if (!panels.length) return;

        currentStepIndex = Math.max(0, Math.min(index, panels.length - 1));

        panels.forEach(function (panel, panelIndex) {
            panel.classList.toggle('is-active', panelIndex === currentStepIndex);
        });

        if (config.scroll !== false) {
            var activePanel = panels[currentStepIndex];
            if (activePanel && typeof activePanel.scrollIntoView === "function") {
                activePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }

    function stepIndexForField(key) {
        var normalized = normalizeErrorFieldName(key);

        if (normalized === 'firstname' || normalized === 'lastname' || normalized === 'email') {
            return 1;
        }

        return 0;
    }

    function setValue(el, value, options) {
        var config = options || {};
        var nextValue = value == null ? "" : String(value);
        var previousValue;
        if (!el) return;

        previousValue = el.value == null ? "" : String(el.value);
        if (previousValue === nextValue && !config.force) {
            if (el.defaultValue !== nextValue) {
                el.defaultValue = nextValue;
            }
            if (el.getAttribute("value") !== nextValue) {
                el.setAttribute("value", nextValue);
            }
            return;
        }

        el.value = nextValue;
        el.defaultValue = nextValue;
        el.setAttribute("value", nextValue);

        if (config.silent) {
            return;
        }

        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function setChecked(el, checked) {
        if (!el) return;
        el.checked = checked;
        if (checked) {
            el.setAttribute("checked", "checked");
        } else {
            el.removeAttribute("checked");
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function parseAmount(value) {
        var cleaned = String(value || "").replace(",", ".").replace(/[^\d.]/g, "");
        var number = parseFloat(cleaned);
        return isFinite(number) ? number : null;
    }

    function formatEuro(value) {
        return "€ " + Number(value || 0).toLocaleString("it-IT", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function syncPrefilledHiddenFields() {
        setValue(nativeQuery('#fiscalcode'), PREFILL_VALUES.fiscalcode, { silent: true });
        setValue(nativeQuery('#address_street'), PREFILL_VALUES.address_street, { silent: true });
        setValue(nativeQuery('#address_city'), PREFILL_VALUES.address_city, { silent: true });
        setValue(nativeQuery('#address_zip'), PREFILL_VALUES.address_zip, { silent: true });
        setValue(nativeQuery('#billing_address'), PREFILL_VALUES.billing_address, { silent: true });
        setValue(nativeQuery('#billing_city'), PREFILL_VALUES.billing_city, { silent: true });
        setValue(nativeQuery('#billing_zip'), PREFILL_VALUES.billing_zip, { silent: true });
        setValue(nativeQuery('#billing_country'), PREFILL_VALUES.billing_country, { silent: true });

        nativeQueryAll('.form-element-fiscalcode [name="fiscalcode"]').forEach(function (node) {
            setValue(node, PREFILL_VALUES.fiscalcode, { silent: true });
        });
    }

    function normalizeErrorFieldName(fieldName) {
        var fieldMap = {
            billing_firstname: "firstname",
            billing_lastname: "lastname",
            billing_email: "email"
        };

        return fieldMap[fieldName] || fieldName;
    }

    function clearCustomErrors() {
        queryAll('#frat-app .frat-field.is-error').forEach(function (field) {
            field.classList.remove('is-error');
        });

        queryAll('#frat-app .frat-input.is-error, #frat-app .frat-select.is-error').forEach(function (field) {
            field.classList.remove('is-error');
        });

        queryAll('#frat-app .frat-option.is-error').forEach(function (option) {
            option.classList.remove('is-error');
        });

        queryAll('#frat-app [data-frat-error-for]').forEach(function (node) {
            node.textContent = "";
        });

        var summary = query('#frat-error');
        if (summary) {
            summary.textContent = "";
            summary.classList.remove('is-visible');
        }
    }

    function setCustomError(key, message) {
        var fieldSelectorMap = {
            firstname: '#frat-firstname',
            lastname: '#frat-lastname',
            email: '#frat-email',
            custom_amount: '#frat-custom_amount'
        };
        var errorSelectorMap = {
            donation_choice_id: '[data-frat-error-for="donation"]',
            custom_amount: '[data-frat-error-for="custom_amount"]',
            firstname: '[data-frat-error-for="firstname"]',
            lastname: '[data-frat-error-for="lastname"]',
            email: '[data-frat-error-for="email"]'
        };
        var input;
        var errorNode;
        var fieldWrapper;

        key = normalizeErrorFieldName(key);

        if (key === 'donation_choice_id' || key === 'custom_amount') {
            queryAll('#frat-app input[name="frat_donation_choice_id"]').forEach(function (radio) {
                var option = radio.closest('.frat-option');
                if (option) {
                    option.classList.add('is-error');
                }
            });
        }

        if (key === 'custom_amount') {
            fieldWrapper = query('#frat-custom-amount-field');
            if (fieldWrapper) {
                fieldWrapper.classList.add('is-error');
            }
        }

        input = fieldSelectorMap[key] ? query(fieldSelectorMap[key]) : null;
        if (input) {
            input.classList.add('is-error');
            fieldWrapper = input.closest('.frat-field');
            if (fieldWrapper) {
                fieldWrapper.classList.add('is-error');
            }
        }

        errorNode = errorSelectorMap[key] ? query(errorSelectorMap[key]) : null;
        if (errorNode) {
            errorNode.textContent = message;
            fieldWrapper = errorNode.closest('.frat-field');
            if (fieldWrapper) {
                fieldWrapper.classList.add('is-error');
            }
        }
    }

    function focusFirstCustomError() {
        var firstInput = query('#frat-app .frat-input.is-error, #frat-app .frat-select.is-error');
        var firstOption = query('#frat-app .frat-option.is-error label');

        if (firstInput && typeof firstInput.focus === "function") {
            firstInput.focus();
            return;
        }

        if (firstOption && typeof firstOption.scrollIntoView === "function") {
            firstOption.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function parseValidationResponseHtml(html) {
        var temp = document.createElement('div');
        var fieldErrors = {};
        var summaryMessages = [];
        var alertMessage = "";

        temp.innerHTML = html || "";

        queryAll('.alert.alert-danger.error, .alert.alert-error.error, .alert-danger.error, .alert-error.error', temp).forEach(function (alertNode) {
            var text = alertNode.textContent.trim();
            if (text && !alertMessage) {
                alertMessage = text;
            }
        });

        queryAll('.form-group[class*="form-element-"]', temp).forEach(function (group) {
            var className = group.className || "";
            var match = className.match(/form-element-([a-zA-Z0-9_]+)/);
            var messageNode = query('.error .text-danger, .error li, .text-danger, .help-block, .invalid-feedback', group);
            var fieldName;
            var message;

            if (!match) return;
            if (!group.classList.contains('has-error') && !messageNode) return;

            fieldName = normalizeErrorFieldName(match[1]);
            message = messageNode ? messageNode.textContent.trim() : "Controlla questo campo.";

            if (!fieldErrors[fieldName]) {
                fieldErrors[fieldName] = message;
            }
            if (message && summaryMessages.indexOf(message) === -1) {
                summaryMessages.push(message);
            }
        });

        return {
            alertMessage: alertMessage,
            fieldErrors: fieldErrors,
            summaryMessages: summaryMessages
        };
    }

    function applyCustomErrors(parsed) {
        var summaryNode = query('#frat-error');
        var summaryText = "";
        var firstErroredField = Object.keys(parsed.fieldErrors || {})[0];

        isSubmitting = false;
        clearPaymentLoaderTransition();
        hideBrandedLoader();
        clearCustomErrors();

        Object.keys(parsed.fieldErrors || {}).forEach(function (key) {
            setCustomError(key, parsed.fieldErrors[key]);
        });

        if (parsed.alertMessage) {
            summaryText = parsed.alertMessage;
        } else if (parsed.summaryMessages && parsed.summaryMessages.length) {
            summaryText = parsed.summaryMessages.join(" ");
        }

        if (summaryNode && summaryText) {
            summaryNode.textContent = summaryText;
            summaryNode.classList.add('is-visible');
        }

        if (summaryText || Object.keys(parsed.fieldErrors || {}).length) {
            setActiveStep(stepIndexForField(firstErroredField || 'donation_choice_id'));
            if (window.HPJUtils && typeof HPJUtils.hideLoadingBox === "function") {
                HPJUtils.hideLoadingBox();
            }
            focusFirstCustomError();
        }
    }

    function syncErrorsFromValidationHtml(html) {
        if (!isSubmitting) {
            return;
        }

        var parsed = parseValidationResponseHtml(html);
        var signature = JSON.stringify(parsed);

        if (!parsed.alertMessage && !parsed.summaryMessages.length && !Object.keys(parsed.fieldErrors).length) {
            lastValidationSignature = "";
            clearCustomErrors();
            return;
        }

        if (signature === lastValidationSignature) {
            if (window.HPJUtils && typeof HPJUtils.hideLoadingBox === "function") {
                HPJUtils.hideLoadingBox();
            }
            return;
        }

        lastValidationSignature = signature;
        applyCustomErrors(parsed);
    }

    function hasServerValidationErrors(parsed) {
        return Boolean(
            parsed &&
            (
                parsed.alertMessage ||
                (parsed.summaryMessages && parsed.summaryMessages.length) ||
                Object.keys(parsed.fieldErrors || {}).length
            )
        );
    }

    function validateDonationServerSide(onSuccess) {
        var wrapper = nativeQuery('.single-page-donation-wrapper');

        clearCustomErrors();
        lastValidationSignature = "";
        syncReceiptType();
        syncAmountChoice();
        syncDonorFields();
        syncPrefilledHiddenFields();
        ensureCardPayment();

        if (
            !wrapper ||
            !window.jQuery ||
            !window.memboGo ||
            !memboGo.Donation ||
            !memboGo.Donation.SingleMode ||
            typeof memboGo.Donation.SingleMode.prepareDataToSend !== "function"
        ) {
            if (typeof onSuccess === "function") {
                onSuccess();
            }
            return;
        }

        jQuery.ajax({
            url: '/' + language + '/method/ajax-registration-donation-info/name/donation/?campaignId=' + wrapper.getAttribute('data-campaign-id'),
            type: 'POST',
            async: true,
            cache: false,
            data: memboGo.Donation.SingleMode.prepareDataToSend(wrapper, 0),
            dataType: 'html',
            processData: false,
            contentType: false,
            success: function (html) {
                var parsed = parseValidationResponseHtml(html);

                if (hasServerValidationErrors(parsed)) {
                    lastValidationSignature = JSON.stringify(parsed);
                    applyCustomErrors(parsed);
                    return;
                }

                clearCustomErrors();
                if (typeof onSuccess === "function") {
                    onSuccess();
                }
            },
            error: function () {
                if (typeof onSuccess === "function") {
                    onSuccess();
                }
            }
        });
    }

    function hasStripeReturnParams() {
        var params = new URLSearchParams(window.location.search);
        return Boolean(
            params.get('redirect_status') ||
            params.get('payment_intent') ||
            params.get('payment_intent_client_secret') ||
            params.get('setup_intent') ||
            params.get('setup_intent_client_secret')
        );
    }

    function getNativePaymentStage() {
        var body = document.body;

        if (
            (body && body.classList.contains('step-confirmation')) ||
            nativeQuery('.form-receiptView') ||
            nativeQuery('#fieldset-ThanksPart') ||
            nativeQuery('.form-element-status .form-control-static')
        ) {
            return 'confirmation';
        }

        if (
            nativeQuery('#js-payment-check') ||
            nativeQuery('#js-payment-check-timeout') ||
            nativeQuery('#js-payment-check-error')
        ) {
            return 'processing';
        }

        if (
            hasStripeReturnParams() ||
            nativeQuery('#payment-form-stripe') ||
            nativeQuery('[data-component="stripe-payment"]') ||
            nativeQuery('.stripe-payment') ||
            nativeQuery('.js-stripe-payment') ||
            nativeQuery('#js-stripe-wrapper') ||
            nativeQuery('#js-stripe-card') ||
            nativeQuery('#js-stripe-error')
        ) {
            return 'payment';
        }

        return null;
    }

    function hasNativePaymentState() {
        return Boolean(getNativePaymentStage());
    }

    function hasSuccessfulConfirmationState() {
        return getNativePaymentStage() === 'confirmation';
    }

    function maybeHidePaymentLoader() {
        if (!pageFullyLoaded) {
            return;
        }

        var stage = getNativePaymentStage();
        var isReady = Boolean(
            stage === 'confirmation' ||
            (
                stage === 'payment' &&
                (
                    nativeQuery('#js-stripe-card iframe') ||
                    nativeQuery('.__PrivateStripeElement iframe') ||
                    nativeQuery('iframe[name^="__privateStripeFrame"]') ||
                    nativeQuery('#payment-form-stripe')
                )
            )
        );

        if (!isReady) {
            return;
        }

        clearPaymentLoaderTransition();
        hideBrandedLoader();
    }

    function startSubmitWatchdog() {
        var attempts = 0;
        var maxAttempts = 40;
        var interval = window.setInterval(function () {
            var hasNativeState = hasNativePaymentState();
            var ajaxIdle = !window.jQuery || window.jQuery.active === 0;

            attempts += 1;

            if (hasNativeState) {
                isSubmitting = false;
                maybeHidePaymentLoader();
                window.clearInterval(interval);
                return;
            }

            if (attempts >= 8 && ajaxIdle) {
                isSubmitting = false;
                if (!(navigationTransitionPending || readSessionFlag(LOADER_SESSION_KEY) === '1')) {
                    clearPaymentLoaderTransition();
                }
                if (window.HPJUtils && typeof HPJUtils.hideLoadingBox === "function") {
                    HPJUtils.hideLoadingBox();
                }
            }

            if (attempts >= maxAttempts) {
                isSubmitting = false;
                if (!(navigationTransitionPending || readSessionFlag(LOADER_SESSION_KEY) === '1')) {
                    clearPaymentLoaderTransition();
                }
                if (window.HPJUtils && typeof HPJUtils.hideLoadingBox === "function") {
                    HPJUtils.hideLoadingBox();
                }
                window.clearInterval(interval);
            }
        }, 150);
    }

    function syncNativeVisibility() {
        var stage;
        var showNativePayment;

        setupDomAnchors();
        stage = getNativePaymentStage();
        showNativePayment = Boolean(stage);

        if (isSubmitting && !showNativePayment) {
            document.body.classList.remove('frat-show-native-payment');
            document.body.classList.remove('frat-has-native-slot-visible');
            return;
        }

        document.body.classList.toggle('frat-show-native-payment', showNativePayment);
        document.body.classList.toggle('frat-has-native-slot-visible', showNativePayment);
        document.body.classList.toggle('frat-native-payment-processing', stage === 'processing');
        document.body.classList.toggle('frat-native-payment-confirmation', stage === 'confirmation');

        maybeHidePaymentLoader();

        if (nativeSlotNode) {
            nativeSlotNode.classList.toggle('is-visible', showNativePayment);
            nativeSlotNode.classList.toggle('frat-native-slot--success', stage === 'confirmation');
        }

        if (showNativePayment) {
            moveNativeMountIntoSlot();
        } else {
            restoreNativeMount();
            if (pendingReturnToStepThree) {
                pendingReturnToStepThree = false;
                hideBrandedLoader();
                clearPaymentLoaderTransition();
                isSubmitting = false;
                window.setTimeout(function () {
                    setActiveStep(2);
                }, 0);
            }
        }
    }

    function renderSuccessState() {
        var existing = query('#frat-success-state');
        var shouldShow = hasSuccessfulConfirmationState();

        ensureNativeSlot();
        var successRoot = nativeSlotNode;
        if (!successRoot) return;

        if (!shouldShow) {
            if (existing) {
                existing.classList.remove('is-visible');
            }
            return;
        }

        if (!existing) {
            existing = document.createElement('div');
            existing.id = 'frat-success-state';
            existing.className = 'frat-success';
            existing.innerHTML = '<div class="frat-success__icon" aria-hidden="true"></div><h1 class="frat-success__title">Grazie per la tua donazione <span aria-hidden="true">❤️</span></h1>';
            successRoot.appendChild(existing);
        }

        existing.classList.add('is-visible');
    }

    function showBillingAutoFill() {
        nativeQueryAll('.billing-auto-fill-address-wrapper, .billing-auto-fill-address-wrapper .form-group, .billing-auto-fill-address-wrapper .rf-checkbox.checkbox.custom-control.custom-checkbox').forEach(function (node) {
            node.style.display = "";
        });

        var checkbox = nativeQuery('#billing_auto_fill_address');
        if (checkbox) {
            checkbox.style.display = "";
        }
    }

    function originalById(id) {
        return nativeQuery('#' + id);
    }

    function bindValidationResponseSync() {
        if (!window.jQuery || jQuery(document).data('fratValidationBound') === "1") {
            return;
        }

        jQuery(document).data('fratValidationBound', "1");

        jQuery(document).ajaxSuccess(function (_event, xhr, settings) {
            var responseText = xhr && typeof xhr.responseText === "string" ? xhr.responseText : "";
            var url = settings && settings.url ? settings.url : "";

            if (url.indexOf('/method/ajax-registration-donation-info/name/donation/') === -1) {
                return;
            }

            syncErrorsFromValidationHtml(responseText);
        });
    }

    function currentOriginalDonationTrigger() {
        var customChoice = query('#frat-app #frat-donation_choice_id-1');
        var wrapper = nativeQuery('.single-page-donation-wrapper');

        if (customChoice && customChoice.checked) {
            return originalById('custom_amount') || originalById('donation_choice_id-1') || wrapper;
        }

        return originalById('donation_choice_id-0') || originalById('donation_choice_id-1') || wrapper;
    }

    function bindNativeBackToStepThree() {
        if (document.body.dataset.fratNativeBackBound === "1") {
            return;
        }

        document.body.dataset.fratNativeBackBound = "1";

        document.body.addEventListener("click", function (event) {
            var backLink = event.target && event.target.closest
                ? event.target.closest('.stripe-payment .btn.btn-link, [data-component="stripe-payment"] .btn.btn-link, .donation-footer-frame .btn.btn-link')
                : null;

            if (!backLink || !nativeSlotNode || !nativeSlotNode.contains(backLink)) {
                return;
            }

            pendingReturnToStepThree = true;

            window.setTimeout(function () {
                syncNativeVisibility();

                if (hasNativePaymentState()) {
                    return;
                }

                document.body.classList.remove('frat-show-native-payment');
                document.body.classList.remove('frat-has-native-slot-visible');
                document.body.classList.remove('frat-native-payment-processing');
                document.body.classList.remove('frat-native-payment-confirmation');

                if (nativeSlotNode) {
                    nativeSlotNode.classList.remove('is-visible');
                    nativeSlotNode.classList.remove('frat-native-slot--success');
                }

                restoreNativeMount();
                hideBrandedLoader();
                clearPaymentLoaderTransition();
                isSubmitting = false;
                setActiveStep(2);
                pendingReturnToStepThree = false;
            }, 40);
        });
    }

    function withNativeSyncVisibility(callback) {
        document.body.classList.add('frat-force-native-sync');

        try {
            callback();
        } finally {
            window.setTimeout(function () {
                document.body.classList.remove('frat-force-native-sync');
            }, 800);
        }
    }

    function refreshOriginalDonationInfo(options) {
        var config = options || {};
        var shouldShowLoader = config.showLoader === true;
        var wrapper = nativeQuery('.single-page-donation-wrapper');

        if (!wrapper) {
            return;
        }

        withNativeSyncVisibility(function () {
            if (
                !window.jQuery ||
                !window.memboGo ||
                !memboGo.Donation ||
                !memboGo.Donation.SingleMode ||
                typeof memboGo.Donation.SingleMode.prepareDataToSend !== "function"
            ) {
                return;
            }

            if (shouldShowLoader && window.HPJUtils && typeof HPJUtils.displayLoadingBox === "function") {
                HPJUtils.displayLoadingBox();
            }

            jQuery.ajax({
                url: '/' + language + '/method/ajax-registration-donation-info/name/donation/?campaignId=' + wrapper.getAttribute('data-campaign-id'),
                type: 'POST',
                async: true,
                cache: false,
                data: memboGo.Donation.SingleMode.prepareDataToSend(wrapper, 0),
                dataType: 'html',
                processData: false,
                contentType: false,
                success: function (html) {
                    var temp = document.createElement('div');
                    temp.innerHTML = html;
                    [
                        'fieldset-paymentmethod',
                        'fieldset-payment_billing',
                        'fieldset-section_payment_summary',
                        'fieldset-section_payment_tip',
                        'fieldset-section_payment_grand_total',
                        'csrf_token'
                    ].forEach(function (id) {
                        var incoming = query('#' + id, temp);
                        var existing = query('#' + id, wrapper);
                        if (incoming && existing) {
                            existing.replaceWith(incoming);
                        }
                    });

                    var incomingFooter = query('.donation-footer-frame', temp);
                    var existingFooter = query('.donation-footer-frame', wrapper);
                    if (incomingFooter && existingFooter) {
                        existingFooter.replaceWith(incomingFooter);
                    }

                    if (window.jQuery) {
                        jQuery('input[name="payment_method"]:checked, input[name="payment_method"][type="hidden"]').trigger('change');
                    }

                    bindOriginalTipFields();
                    syncTipFromOriginal();

                    if (shouldShowLoader && window.HPJUtils && typeof HPJUtils.hideLoadingBox === "function") {
                        HPJUtils.hideLoadingBox();
                    }
                },
                error: function () {
                    if (shouldShowLoader && window.HPJUtils && typeof HPJUtils.hideLoadingBox === "function") {
                        HPJUtils.hideLoadingBox();
                    }
                }
            });
        });
    }

    function scheduleOriginalDonationRefresh(delay, options) {
        window.clearTimeout(donationRefreshTimer);
        donationRefreshTimer = window.setTimeout(function () {
            refreshOriginalDonationInfo(options);
            scheduleTipSync();
        }, delay || 0);
    }

    function originalTipFields() {
        return nativeQueryAll('#tip_amount, [name="tip_amount"]');
    }

    function bindOriginalTipFields() {
        originalTipFields().forEach(function (tipField) {
            if (tipField.dataset.fratTipBound === "1") return;
            tipField.dataset.fratTipBound = "1";
            tipField.addEventListener("input", syncTipFromOriginal);
            tipField.addEventListener("change", syncTipFromOriginal);
        });
    }

    function readRenderedTipAmount() {
        var renderedAmount = nativeQuery('.js-payment-tip-amount > span') ||
            nativeQuery('.js-payment-tip-amount');

        return parseAmount(renderedAmount ? renderedAmount.textContent : "");
    }

    function readSuggestedTipAmount() {
        var fields = originalTipFields();
        var rendered = readRenderedTipAmount();
        var preferred = null;
        var fallback = null;

        fields.forEach(function (tipField) {
            var fieldDefault = parseAmount(tipField ? tipField.getAttribute('data-default') : "");
            var fieldValue = parseAmount(tipField ? tipField.value : "");

            if (fieldDefault !== null && preferred === null) {
                preferred = fieldDefault;
            }
            if (fieldValue !== null && fallback === null) {
                fallback = fieldValue;
            }
        });

        if (!tipManuallyEdited && rendered !== null) {
            return rendered;
        }

        if (!tipManuallyEdited && preferred !== null) {
            return preferred;
        }

        if (fallback !== null) {
            return fallback;
        }

        if (rendered !== null) {
            return rendered;
        }

        return preferred;
    }

    function scheduleTipSync() {
        [0, 80, 250, 600, 1200].forEach(function (delay) {
            window.setTimeout(function () {
                bindOriginalTipFields();
                syncTipFromOriginal();
            }, delay);
        });
    }

    function syncReceiptType() {
        ["0", "1", "2"].forEach(function (suffix) {
            var target = originalById('receipt_type-' + suffix);
            if (!target) return;

            setChecked(target, suffix === "0");
        });
    }

    function syncAmountChoice() {
        var customChoice = query('#frat-app #frat-donation_choice_id-1');
        var fixedChoice = query('#frat-app #frat-donation_choice_id-0');
        var targetFixed = originalById('donation_choice_id-0');
        var targetOther = originalById('donation_choice_id-1');
        var customAmount = query('#frat-app #frat-custom_amount');
        var targetCustomAmount = originalById('custom_amount');
        var customAmountField = query('#frat-custom-amount-field');
        var nextButton = query('#frat-app #frat-step-amount-next');
        var hasFixedSelected = Boolean(fixedChoice && fixedChoice.checked);
        var hasCustomSelected = Boolean(customChoice && customChoice.checked);

        if (fixedChoice && targetFixed) setChecked(targetFixed, hasFixedSelected);
        if (customChoice && targetOther) setChecked(targetOther, hasCustomSelected);
        if (customAmount && targetCustomAmount) {
            setValue(targetCustomAmount, customAmount.value);
        }
        if (customAmountField) {
            customAmountField.classList.toggle('is-visible', hasCustomSelected);
        }
        if (nextButton) {
            nextButton.classList.toggle('is-hidden', !hasCustomSelected);
        }
    }

    function validateAmountStep() {
        var fixedChoice = query('#frat-app #frat-donation_choice_id-0');
        var customChoice = query('#frat-app #frat-donation_choice_id-1');
        var customAmount = query('#frat-app #frat-custom_amount');
        var parsedAmount = parseAmount(customAmount ? customAmount.value : "");

        clearCustomErrors();

        if (fixedChoice && fixedChoice.checked) {
            return true;
        }

        if (customChoice && customChoice.checked) {
            if (parsedAmount === null || parsedAmount <= 0) {
                setCustomError('custom_amount', "Inserisci un importo valido.");
                focusFirstCustomError();
                return false;
            }

            return true;
        }

        setCustomError('donation_choice_id', "Seleziona un importo.");
        focusFirstCustomError();
        return false;
    }

    function syncCustomAmountRefreshState() {
        tipManuallyEdited = false;
        syncAmountChoice();
        scheduleOriginalDonationRefresh(0);
        updateSummary();
        persistFormCache();
    }

    function syncTipFromOriginal() {
        var nextTipAmount = readSuggestedTipAmount();

        if (nextTipAmount === null) return;
        if (nextTipAmount === currentTipAmount) return;

        currentTipAmount = nextTipAmount;
        updateTipUi();
        updateSummary();
    }

    function syncDonorFields() {
        var first = query('#frat-app #frat-firstname');
        var last = query('#frat-app #frat-lastname');
        var email = query('#frat-app #frat-email');

        var origFirst = originalById('firstname');
        var origLast = originalById('lastname');
        var origEmail = originalById('email');

        if (first && origFirst) setValue(origFirst, first.value);
        if (last && origLast) setValue(origLast, last.value);
        if (email && origEmail) setValue(origEmail, email.value);

        setValue(nativeQuery('#billing_firstname'), first ? first.value : "");
        setValue(nativeQuery('#billing_lastname'), last ? last.value : "");
        setValue(nativeQuery('#billing_email'), email ? email.value : "");
    }

    function ensureCardPayment() {
        var card = originalById('payment_method-0');
        var bonifico = originalById('payment_method-1');
        if (bonifico) bonifico.checked = false;
        if (card) setChecked(card, true);
    }

    function euro(value) {
        var number = parseAmount(value);
        if (!isFinite(number)) return null;
        return "€ " + number.toLocaleString("it-IT", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function updateSummary() {
        var fixed = query('#frat-app #frat-donation_choice_id-0');
        var amountField = query('#frat-app #frat-custom_amount');
        var summary = query('#frat-app #frat-summary-amount');
        var baseAmount = 6;
        if (!summary) return;

        if (!(fixed && fixed.checked)) {
            baseAmount = parseAmount(amountField ? amountField.value : "") || 0;
        }

        summary.textContent = formatEuro(baseAmount + currentTipAmount);
    }

    function updateTipUi() {
        var amount = query('#frat-tip-amount');
        var removeButton = query('#frat-tip-remove');
        if (amount) {
            amount.textContent = formatEuro(currentTipAmount);
        }

        if (removeButton) {
            removeButton.disabled = currentTipAmount === 0;
        }

        queryAll('#frat-tip-editor .frat-tip__option').forEach(function (button) {
            button.classList.toggle('is-active', Number(button.getAttribute('data-tip-value')) === currentTipAmount);
        });
    }

    function setTipAmount(value, options) {
        var config = options || {};
        currentTipAmount = Number(value);
        tipManuallyEdited = config.manual !== false;
        updateTipUi();
        updateSummary();

        originalTipFields().forEach(function (tipField) {
            setValue(tipField, String(currentTipAmount));
        });

        persistFormCache();
    }

    function initCustomFields() {
        var fixedChoice = query('#frat-app #frat-donation_choice_id-0');
        var otherChoice = query('#frat-app #frat-donation_choice_id-1');
        var customAmount = query('#frat-app #frat-custom_amount');
        var first = query('#frat-app #frat-firstname');
        var last = query('#frat-app #frat-lastname');
        var email = query('#frat-app #frat-email');

        if (customAmount) customAmount.value = "";
        if (first) first.value = originalById('firstname')?.value || "";
        if (last) last.value = originalById('lastname')?.value || "";
        if (email) email.value = originalById('email')?.value || "";

        if (fixedChoice) {
            fixedChoice.checked = false;
            fixedChoice.removeAttribute("checked");
        }
        if (otherChoice) {
            otherChoice.checked = false;
            otherChoice.removeAttribute("checked");
        }

        restoreFormCache();
        syncReceiptType();
        syncAmountChoice();
        syncDonorFields();
        setTipAmount(currentTipAmount, { manual: false });
        updateSummary();
    }

    function bindUi() {
        bindOriginalTipFields();

        queryAll('#frat-app [data-step-next]').forEach(function (button) {
            if (button.getAttribute('data-step-next') === '1') {
                button.addEventListener("mousedown", function () {
                    suppressCustomAmountBlurRefresh = true;
                });
            }

            button.addEventListener("click", function () {
                if (button.getAttribute('data-step-next') === '1') {
                    if (!validateAmountStep()) {
                        return;
                    }
                    syncCustomAmountRefreshState();
                    setActiveStep(Number(button.getAttribute('data-step-next')));
                    return;
                }

                if (button.getAttribute('data-step-next') === '2') {
                    validateDonationServerSide(function () {
                        setActiveStep(2);
                    });
                    return;
                }

                setActiveStep(Number(button.getAttribute('data-step-next')));
            });
        });

        queryAll('#frat-app [data-step-prev]').forEach(function (button) {
            button.addEventListener("click", function () {
                setActiveStep(Number(button.getAttribute('data-step-prev')));
            });
        });

        queryAll('#frat-app input[name="frat_donation_choice_id"]').forEach(function (input) {
            input.addEventListener("change", function () {
                tipManuallyEdited = false;
                syncAmountChoice();
                scheduleOriginalDonationRefresh(0);
                updateSummary();
                persistFormCache();

                if (input.id === 'frat-donation_choice_id-0' && input.checked) {
                    clearCustomErrors();
                    setActiveStep(1);
                }
            });
        });

        var fixedOptionLabel = query('#frat-app label[for="frat-donation_choice_id-0"]');
        if (fixedOptionLabel) {
            fixedOptionLabel.addEventListener("click", function () {
                var fixedChoice = query('#frat-app #frat-donation_choice_id-0');

                window.setTimeout(function () {
                    if (!(fixedChoice && fixedChoice.checked)) {
                        return;
                    }

                    tipManuallyEdited = false;
                    clearCustomErrors();
                    syncAmountChoice();
                    scheduleOriginalDonationRefresh(0);
                    updateSummary();
                    persistFormCache();
                    setActiveStep(1);
                }, 0);
            });
        }

        query('#frat-app #frat-custom_amount').addEventListener("input", function () {
            query('#frat-app #frat-donation_choice_id-1').checked = true;
            query('#frat-app #frat-donation_choice_id-0').checked = false;
            tipManuallyEdited = false;
            syncAmountChoice();
            scheduleOriginalDonationRefresh(180);
            updateSummary();
            persistFormCache();
        });

        query('#frat-app #frat-custom_amount').addEventListener("blur", function () {
            if (suppressCustomAmountBlurRefresh) {
                suppressCustomAmountBlurRefresh = false;
                return;
            }
            tipManuallyEdited = false;
            syncAmountChoice();
            scheduleOriginalDonationRefresh(0);
        });

        function toggleTipEditor() {
            var tipBox = query('#frat-tip');
            if (tipBox) {
                tipBox.classList.toggle('is-editing');
            }
        }

        query('#frat-app #frat-tip-edit').addEventListener("click", toggleTipEditor);

        query('#frat-app #frat-tip-remove').addEventListener("click", function () {
            setTipAmount(0);
            query('#frat-tip').classList.remove('is-editing');
        });

        queryAll('#frat-tip-editor .frat-tip__option').forEach(function (button) {
            button.addEventListener("click", function () {
                setTipAmount(button.getAttribute('data-tip-value'));
                query('#frat-tip').classList.remove('is-editing');
            });
        });

        ["frat-firstname", "frat-lastname", "frat-email"].forEach(function (id) {
            query('#frat-app #' + id).addEventListener("input", function () {
                clearCustomErrors();
                syncDonorFields();
                persistFormCache();
            });
        });

        query('#frat-app #frat-email').addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                setActiveStep(2);
            }
        });

        query('#frat-app #frat-custom_amount').addEventListener("input", clearCustomErrors);

        queryAll('#frat-app input[name="frat_donation_choice_id"]').forEach(function (input) {
            input.addEventListener("change", clearCustomErrors);
        });

        query('#frat-app #frat-submit').addEventListener("click", function () {
            isSubmitting = true;
            lastValidationSignature = "";
            clearCustomErrors();
            beginPaymentLoaderTransition();
            syncReceiptType();
            syncAmountChoice();
            syncDonorFields();
            syncPrefilledHiddenFields();
            ensureCardPayment();

            var originalButton = originalById('external_payment');
            if (originalButton) {
                window.setTimeout(function () {
                    originalButton.click();
                    startSubmitWatchdog();
                }, 40);

                [120, 300, 600, 1000, 1600].forEach(function (delay) {
                    window.setTimeout(function () {
                        syncNativeVisibility();
                    }, delay);
                });
            }
        });
    }

    function boot() {
        setupDomAnchors();

        ensureTransitionOverlay();

        if (navigationTransitionPending) {
            showTransitionOverlay();
            showBrandedLoader('compact');
        }

        if (!query('#frat-app') || !getNativeLine()) {
            setInitialLoadingState(false);
            hideInitialLoader();
            return;
        }

        syncPrefilledHiddenFields();
        showBillingAutoFill();
        ensureCardPayment();
        patchYaplaLoader();
        initCustomFields();
        bindUi();
        bindNativeBackToStepThree();
        bindValidationResponseSync();
        setActiveStep(0, { scroll: false });
        syncNativeVisibility();
        renderSuccessState();
        bindOriginalTipFields();
        syncTipFromOriginal();

        if (hasNativePaymentState()) {
            initialLoaderPending = false;
            setLoaderMode('compact');
            maybeHidePaymentLoader();
        }

        setInitialLoadingState(false);
        hideInitialLoader();

        var retries = 0;
        var interval = setInterval(function () {
            syncPrefilledHiddenFields();
            showBillingAutoFill();
            ensureCardPayment();
            patchYaplaLoader();
            syncNativeVisibility();
            renderSuccessState();
            bindOriginalTipFields();
            syncTipFromOriginal();
            retries += 1;
            if (retries > 20) clearInterval(interval);
        }, 300);

        var observer = new MutationObserver(function () {
            patchYaplaLoader();
            syncNativeVisibility();
            renderSuccessState();
            bindOriginalTipFields();
            syncTipFromOriginal();
            maybeHidePaymentLoader();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    onReady(boot);
})();
