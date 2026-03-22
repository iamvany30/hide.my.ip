// ==UserScript==
// @name         Hide.my.IP
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Продвинутый щит конфиденциальности для стримеров с приватным, адаптивным UI. Оптимизирован от микро-миганий.
// @author       Hide.my.IP
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.ipify.org
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG_PATH = "https://example.com/?hide";
    const HIDDEN_IP_PLACEHOLDER = "[HIDDEN]";

    const defaultSettings = {
        gen: false,
        man: true,
        auto: true,
        never: false
    };

    let settings = GM_getValue('h_settings', defaultSettings);
    let list = GM_getValue('h_list',[]);
    let currentIP = GM_getValue('h_ip', '');

    let activePattern = null;

    GM_registerMenuCommand("Settings", () => {
        window.open(CONFIG_PATH, "_blank");
    });

    if (window.location.href.startsWith(CONFIG_PATH)) {
        renderSettingsPage();
        return;
    }

    GM_addStyle(`
        .h-blur {
            filter: blur(20px) !important;
            transition: filter 0.2s ease !important;
            cursor: pointer !important;
            user-select: none !important;
            background-color: rgba(128,128,128,0.1) !important;
            border-radius: 4px !important;
            display: inline-block !important;
        }
        .h-blur:not(.h-show):hover { filter: blur(15px) !important; }
        .h-blur.h-show {
            filter: blur(0) !important;
            background-color: transparent !important;
            user-select: auto !important;
        }
        .h-strict {
            user-select: none !important;
            display: inline-block !important;
            font-weight: bold !important;
        }
    `);

    function compilePattern() {
        const patterns =[];
        const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        if (settings.gen) {
            patterns.push("\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b");
        }
        if (settings.man) {
            list.forEach(item => {
                if (item && item.trim()) patterns.push(escapeRegex(item.trim()));
            });
        }
        if (settings.auto && currentIP) {
            patterns.push(escapeRegex(currentIP));
        }

        activePattern = patterns.length > 0 ? new RegExp(`(${patterns.join('|')})`, 'gi') : null;
    }

    compilePattern();

    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT', 'HEAD', 'IFRAME']);

    function processNode(node) {
        if (!activePattern) return;

        const walker = document.createTreeWalker(
            node,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(textNode) {
                    const parent = textNode.parentNode;
                    if (!parent) return NodeFilter.FILTER_REJECT;

                    if (SKIP_TAGS.has(parent.nodeName)) return NodeFilter.FILTER_REJECT;
                    if (parent.classList && (parent.classList.contains('h-blur') || parent.classList.contains('h-strict'))) return NodeFilter.FILTER_REJECT;
                    if (parent.closest && parent.closest('[data-h-ignore]')) return NodeFilter.FILTER_REJECT;

                    if (activePattern.test(textNode.nodeValue)) {
                        activePattern.lastIndex = 0;
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_REJECT;
                }
            }
        );

        const nodesToProcess =[];
        let currentNode;
        while ((currentNode = walker.nextNode())) {
            nodesToProcess.push(currentNode);
        }

        for (let i = 0; i < nodesToProcess.length; i++) {
            const textNode = nodesToProcess[i];
            const text = textNode.nodeValue;

            if (settings.never) {
                textNode.nodeValue = text.replace(activePattern, HIDDEN_IP_PLACEHOLDER);
                continue;
            }

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;

            text.replace(activePattern, (match, _, offset) => {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex, offset)));
                const span = document.createElement('span');

                const isActuallyIP = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(match);
                span.className = 'h-blur';
                span.textContent = isActuallyIP ? HIDDEN_IP_PLACEHOLDER : match;

                span.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    span.classList.toggle('h-show');
                    span.textContent = span.classList.contains('h-show') ? match : (isActuallyIP ? HIDDEN_IP_PLACEHOLDER : match);
                };

                fragment.appendChild(span);
                lastIndex = offset + match.length;
            });

            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            if (textNode.parentNode) {
                textNode.parentNode.replaceChild(fragment, textNode);
            }
        }
    }

    function fetchIP(callback) {
        GM_xmlhttpRequest({
            method: "GET",
            url: "https://api.ipify.org?format=json",
            onload: (response) => {
                try {
                    const newIP = JSON.parse(response.responseText).ip;
                    if (newIP && newIP !== currentIP) {
                        currentIP = newIP;
                        GM_setValue('h_ip', currentIP);
                        compilePattern();
                        if (callback) callback(currentIP);
                    }
                } catch (e) {
                    console.error("Hide.my.IP: Failed to parse IP.", e);
                }
            }
        });
    }

    function initializeObserver() {
        const observer = new MutationObserver(mutations => {
            for (let i = 0; i < mutations.length; i++) {
                const mutation = mutations[i];
                if (mutation.type === 'childList') {
                    for (let j = 0; j < mutation.addedNodes.length; j++) {
                        const node = mutation.addedNodes[j];
                        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
                            processNode(node);
                        }
                    }
                } else if (mutation.type === 'characterData') {
                    processNode(mutation.target.parentNode);
                }
            }
        });

        const init = () => {
            if (document.body) {
                processNode(document.body);
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
            } else {
                setTimeout(init, 50);
            }
        };

        if (document.readyState === 'loading') {
            const earlyObserver = new MutationObserver((m, obs) => {
                if (document.body) {
                    obs.disconnect();
                    init();
                }
            });
            earlyObserver.observe(document.documentElement, { childList: true, subtree: true });
        } else {
            init();
        }
    }

    if (settings.auto && !currentIP) {
        fetchIP();
    }

    initializeObserver();

    function renderSettingsPage() {
        window.stop();
        document.documentElement.innerHTML = `<head><meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no"></head><body></body>`;
        document.title = "Hide.my.IP Settings";

        const detectTheme = () => {
            const ua = navigator.userAgent;
            if (ua.includes('Firefox')) return 'theme-firefox';
            if (ua.includes('Safari') && !ua.includes('Chrome')) return 'theme-safari';
            if (ua.includes('Chrome')) return 'theme-chrome';
            return 'theme-default';
        };

        GM_addStyle(`
            :root {
                --c-bg: #0A0A0A; --c-text: #EAEAEA; --c-border: #27272a; --c-surface: #171717;
                --c-primary: #FAFAFA; --c-primary-text: #0A0A0A; --c-danger: #ef4444; --c-muted: #71717a;
                --radius-s: 4px; --radius-m: 8px; --radius-l: 12px; --font: "Inter", -apple-system, sans-serif;
            }
            .theme-chrome { --c-bg: #1C1B1F; --c-text: #E6E1E5; --c-surface: #2c2b30; --c-border: #49454F; --c-primary: #D0BCFF; --c-primary-text: #381E72; --c-danger: #F2B8B5; --c-muted: #CAC4D0; --radius-l: 16px; --font: "Roboto", sans-serif; }
            .theme-safari { --c-bg: #000000; --c-text: #ffffff; --c-surface: #1C1C1E; --c-border: #38383A; --c-primary: #0A84FF; --c-primary-text: #ffffff; --c-danger: #FF453A; --c-muted: #8E8E93; --radius-l: 10px; --font: -apple-system, "SF Pro", sans-serif; }
            .theme-firefox { --c-bg: #202023; --c-text: #FBFBFE; --c-surface: #343438; --c-border: #4e4e52; --c-primary: #A68BFF; --c-primary-text: #14005D; --c-danger: #FF9B8F; --c-muted: #C7C5D0; --radius-l: 8px; --font: "Segoe UI", "Ubuntu", sans-serif; }
            body { background: var(--c-bg); color: var(--c-text); font-family: var(--font); margin: 0; display: flex; justify-content: center; padding: 6vh 16px 8vh; }
            .ui { width: 100%; max-width: 480px; }
            h1 { font-size: 26px; font-weight: 700; margin: 0 0 28px; display: flex; align-items: baseline; gap: 8px; }
            h1 span { font-size: 14px; font-weight: 500; color: var(--c-muted); }
            .group-title { font-size: 12px; font-weight: 600; text-transform: uppercase; margin: 28px 0 10px; color: var(--c-muted); letter-spacing: 0.5px; padding-left: 4px; }
            .group { background: var(--c-surface); border-radius: var(--radius-l); }
            .item { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; position: relative; }
            .item:not(:last-child)::after { content: ''; position: absolute; bottom: 0; left: 16px; right: 0; height: 1px; background: var(--c-border); }
            .item-label { font-size: 15px; }
            .item-label span { font-size: 12px; color: var(--c-muted); margin-top: 4px; display: block; }
            input[type="checkbox"] { flex-shrink: 0; appearance: none; width: 48px; height: 28px; background: var(--c-border); border-radius: 28px; position: relative; cursor: pointer; outline: none; transition: all 0.2s ease-in-out; }
            input[type="checkbox"]::after { content: ''; position: absolute; width: 22px; height: 22px; background: #fff; border-radius: 50%; top: 3px; left: 3px; transition: all 0.2s ease-in-out; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
            input[type="checkbox"]:checked { background: var(--c-primary); }
            input[type="checkbox"]:checked::after { transform: translateX(20px); }
            input[type="text"] { width: 100%; padding: 14px 16px; border: 1px solid var(--c-border); background: var(--c-surface); color: var(--c-text); border-radius: var(--radius-m); font-size: 14px; outline: none; box-sizing: border-box; margin-bottom: 12px; transition: border-color 0.2s; }
            input[type="text"]:focus { border-color: var(--c-primary); }
            button { width: 100%; padding: 14px; border: none; border-radius: var(--radius-m); font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity 0.2s; background: var(--c-primary); color: var(--c-primary-text); }
            button:hover { opacity: 0.85; }
            button.danger { background: var(--c-danger); color: var(--c-primary-text); }
            .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
            .tag { background: var(--c-border); color: var(--c-text); padding: 8px 12px; border-radius: var(--radius-s); font-size: 14px; display: flex; align-items: center; gap: 8px; }
            .tag-text { cursor: pointer; user-select: none; filter: blur(8px); transition: filter 0.2s; }
            .tag-text.shown { filter: blur(0); }
            .tag-rm { cursor: pointer; color: var(--c-muted); font-weight: bold; font-size: 18px; line-height: 1; transition: color 0.2s; }
            .tag-rm:hover { color: var(--c-danger); }
            .ip-box { font-family: monospace; font-size: 16px; filter: blur(8px); cursor: pointer; transition: filter 0.2s; letter-spacing: 1px; padding: 4px 0; }
            .ip-box.shown { filter: blur(0); }
            .btn-inline { width: auto; padding: 6px 12px; font-size: 12px; border-radius: var(--radius-s); background: var(--c-border); color: var(--c-text); }
        `);

        document.body.className = detectTheme();
        const app = document.createElement('div');
        app.className = 'ui';
        app.setAttribute('data-h-ignore', 'true');
        app.innerHTML = `
            <h1>Hide.my.IP <span>2.0 Turbo</span></h1>
            <div class="group-title">Protection Rules</div>
            <div class="group">
                <div class="item"><div class="item-label">Global IP Blur<span>Hides any IPv4 address</span></div><input type="checkbox" id="g" ${settings.gen ? 'checked' : ''}></div>
                <div class="item"><div class="item-label">Auto-detect IP<span>Hides your public IP address</span></div><input type="checkbox" id="a" ${settings.auto ? 'checked' : ''}></div>
                <div class="item"><div class="item-label">Strict Mode (Zero-Flash)<span>Replaces IP with [HIDDEN] instantly</span></div><input type="checkbox" id="n" ${settings.never ? 'checked' : ''}></div>
                <div class="item"><div class="item-label">Manual List<span>Hides your custom keywords</span></div><input type="checkbox" id="m" ${settings.man ? 'checked' : ''}></div>
            </div>
            <div class="group-title">Network</div>
            <div class="group">
                <div class="item">
                    <div class="item-label">Your Public IP</div>
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div id="v" class="ip-box">${currentIP ? HIDDEN_IP_PLACEHOLDER : 'N/A'}</div>
                        <button id="u" class="btn-inline">Sync</button>
                    </div>
                </div>
            </div>
            <div class="group-title">Custom Keywords</div>
            <div>
                <input type="text" id="i" placeholder="Add sensitive text and press Enter...">
                <div id="t" class="tags"></div>
            </div>
            <div style="margin-top: 40px;"><button id="r" class="danger">Reset All Settings</button></div>
        `;
        document.body.appendChild(app);

        const syncSettings = () => {
            GM_setValue('h_settings', settings);
            compilePattern();
        };

        document.getElementById('g').onchange = e => { settings.gen = e.target.checked; syncSettings(); };
        document.getElementById('a').onchange = e => { settings.auto = e.target.checked; syncSettings(); };
        document.getElementById('n').onchange = e => { settings.never = e.target.checked; syncSettings(); };
        document.getElementById('m').onchange = e => { settings.man = e.target.checked; syncSettings(); };

        const ipBox = document.getElementById('v');
        ipBox.onclick = () => {
            ipBox.classList.toggle('shown');
            ipBox.textContent = ipBox.classList.contains('shown') ? currentIP : (currentIP ? HIDDEN_IP_PLACEHOLDER : 'N/A');
        };
        document.getElementById('u').onclick = () => {
            ipBox.textContent = '...';
            fetchIP(ip => {
                ipBox.textContent = ipBox.classList.contains('shown') ? ip : HIDDEN_IP_PLACEHOLDER;
            });
        };

        const tagsContainer = document.getElementById('t');
        const customInput = document.getElementById('i');

        const renderTags = () => {
            tagsContainer.innerHTML = list.map((item, index) =>
                `<div class="tag"><span class="tag-text" data-index="${index}">${item}</span><span class="tag-rm" data-index="${index}">×</span></div>`
            ).join('');
        };

        tagsContainer.addEventListener('click', (e) => {
            const target = e.target;
            const index = target.dataset.index;
            if (index === undefined) return;

            if (target.classList.contains('tag-text')) {
                target.classList.toggle('shown');
            } else if (target.classList.contains('tag-rm')) {
                list.splice(index, 1);
                GM_setValue('h_list', list);
                compilePattern();
                renderTags();
            }
        });

        const addToList = () => {
            const value = customInput.value.trim();
            if (value && !list.includes(value)) {
                list.push(value);
                GM_setValue('h_list', list);
                compilePattern();
                customInput.value = '';
                renderTags();
            }
        };

        customInput.onkeydown = e => { if (e.key === 'Enter') addToList(); };

 document.getElementById('r').onclick = () => {
            if (confirm('This will delete all your settings and custom keywords. Are you sure?')) {
                GM_setValue('h_list',[]);
                GM_setValue('h_ip', '');
                GM_setValue('h_settings', defaultSettings);
                location.reload();
            }
        };

        renderTags();
    }
})();
