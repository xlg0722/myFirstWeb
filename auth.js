/**
 * 登录 / 注册 / 会话保持 / 下载鉴权
 * 依赖：@supabase/supabase-js CDN、supabase-config.js
 */
(function () {
    'use strict';

    const cfg = window.SUPABASE_CONFIG;

    // SDK 或配置缺失时（多半是 CDN 没加载成功）仍然显示登录入口，提交时给出提示
    if (!cfg || !cfg.url || !cfg.publishableKey || !window.supabase) {
        const box = document.getElementById('nav-account');
        if (box) {
            const login = document.createElement('a');
            login.href = '#login';
            login.className = 'nav-link';
            login.dataset.page = 'login';
            login.textContent = '登录';
            box.appendChild(login);
        }
        document.querySelectorAll('.auth-form').forEach(function (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                const el = form.querySelector('.auth-msg');
                if (el) {
                    el.textContent = '登录服务加载失败，请检查网络后刷新页面';
                    el.dataset.state = 'error';
                }
            });
        });
        return;
    }

    const sb = window.supabase.createClient(cfg.url, cfg.publishableKey);

    const accountBox = document.getElementById('nav-account');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const verifyForm = document.getElementById('verify-form');
    const verifyEmail = document.getElementById('verify-email');
    const resendButton = document.getElementById('resend-code');
    const downloadButton = document.getElementById('download-latest');
    const downloadMsg = document.getElementById('download-msg');

    // 待验证邮箱：注册或登录提示未验证时记下，刷新页面后仍能显示
    const PENDING_KEY = 'silogu.pendingEmail';

    function setPendingEmail(email) {
        try { localStorage.setItem(PENDING_KEY, email); } catch (e) { /* 隐私模式下忽略 */ }
        showPendingEmail();
    }

    function getPendingEmail() {
        try { return localStorage.getItem(PENDING_KEY) || ''; } catch (e) { return ''; }
    }

    function showPendingEmail() {
        if (verifyEmail) verifyEmail.textContent = getPendingEmail() || '你的邮箱';
    }

    function goPage(name) {
        if (window.SilguSite && typeof window.SilguSite.showPage === 'function') {
            window.SilguSite.showPage(name);
        } else {
            location.hash = name;
        }
    }

    function showMessage(form, text, state) {
        if (!form) return;
        const el = form.querySelector('.auth-msg');
        if (!el) return;
        el.textContent = text || '';
        el.dataset.state = text ? (state || 'error') : '';
    }

    function translateError(message) {
        if (/Invalid login credentials/i.test(message)) return '邮箱或密码错误';
        if (/Email not confirmed/i.test(message)) return '邮箱还没验证，请先输入邮箱收到的验证码';
        if (/User already registered/i.test(message)) return '这个邮箱已经注册过了';
        if (/Password should be at least/i.test(message)) return '密码至少 6 位';
        if (/Unable to validate email/i.test(message)) return '邮箱格式不正确';
        if (/Token has expired|expired or is invalid|invalid.*token/i.test(message)) return '验证码已过期，请重新发送';
        if (/Token.*not found|otp.*not found/i.test(message)) return '验证码不正确，请检查后重试';
        if (/rate limit|too many/i.test(message)) return '操作太频繁，稍后再试';
        if (/Failed to fetch/i.test(message)) return '连不上服务器，检查网络后重试';
        return message;
    }

    function displayNameOf(user) {
        const name = (user.email || '').split('@')[0];
        return name || '玩家';
    }

    function renderAccount(user) {
        if (!accountBox) return;
        accountBox.textContent = '';

        if (user) {
            const name = document.createElement('span');
            name.className = 'nav-account__name';
            name.textContent = displayNameOf(user);

            const logout = document.createElement('button');
            logout.type = 'button';
            logout.className = 'nav-link nav-account__logout';
            logout.dataset.action = 'logout';
            logout.textContent = '退出';

            accountBox.append(name, logout);
            return;
        }

        const login = document.createElement('a');
        login.href = '#login';
        login.className = 'nav-link';
        login.dataset.page = 'login';
        login.textContent = '登录';
        accountBox.appendChild(login);
    }

    if (accountBox) {
        accountBox.addEventListener('click', function (e) {
            if (e.target.closest('[data-action="logout"]')) {
                e.preventDefault();
                sb.auth.signOut();
            }
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const email = loginForm.email.value.trim();
            const password = loginForm.password.value;
            const submit = loginForm.querySelector('button[type="submit"]');

            showMessage(loginForm, '');
            submit.disabled = true;
            submit.textContent = '登录中…';

            const result = await sb.auth.signInWithPassword({ email, password });

            submit.disabled = false;
            submit.textContent = '登录';

            if (result.error) {
                if (/Email not confirmed/i.test(result.error.message)) {
                    setPendingEmail(email);
                    goPage('verify');
                    return;
                }
                showMessage(loginForm, translateError(result.error.message));
                return;
            }

            loginForm.reset();
            goPage('home');
        });
    }

    if (registerForm) {
        registerForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const email = registerForm.email.value.trim();
            const password = registerForm.password.value;
            const confirm = registerForm.confirm.value;
            const submit = registerForm.querySelector('button[type="submit"]');

            if (password.length < 6) {
                showMessage(registerForm, '密码至少 6 位');
                return;
            }
            if (password !== confirm) {
                showMessage(registerForm, '两次输入的密码不一致');
                return;
            }

            showMessage(registerForm, '');
            submit.disabled = true;
            submit.textContent = '注册中…';

            const result = await sb.auth.signUp({
                email: email,
                password: password,
                options: {
                    // 邮箱验证链接会跳回当前站点
                    emailRedirectTo: location.origin + location.pathname
                }
            });

            submit.disabled = false;
            submit.textContent = '注册';

            if (result.error) {
                showMessage(registerForm, translateError(result.error.message));
                return;
            }

            registerForm.reset();

            if (result.data.session) {
                goPage('home');
                return;
            }

            setPendingEmail(email);
            goPage('verify');
            if (verifyForm) {
                showMessage(verifyForm, '验证码已发送，请到邮箱查收', 'success');
            }
        });
    }

    // 输入验证码完成邮箱验证
    if (verifyForm) {
        verifyForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const email = getPendingEmail();
            const token = verifyForm.token.value.replace(/\s+/g, '');
            const submit = verifyForm.querySelector('button[type="submit"]');

            if (!email) {
                showMessage(verifyForm, '找不到待验证的邮箱，请重新注册');
                goPage('register');
                return;
            }
            if (!/^\d{6}$/.test(token)) {
                showMessage(verifyForm, '请输入 6 位数字验证码');
                return;
            }

            showMessage(verifyForm, '');
            submit.disabled = true;
            submit.textContent = '验证中…';

            const result = await sb.auth.verifyOtp({
                email: email,
                token: token,
                type: 'signup'
            });

            submit.disabled = false;
            submit.textContent = '验证并登录';

            if (result.error) {
                showMessage(verifyForm, translateError(result.error.message));
                return;
            }

            verifyForm.reset();
            goPage('home');
        });
    }

    // 重新发送验证码，60 秒冷却
    if (resendButton) {
        let countdown = 0;
        let timer = null;

        const tick = function () {
            countdown -= 1;
            if (countdown > 0) {
                resendButton.disabled = true;
                resendButton.textContent = countdown + ' 秒后可重发';
                return;
            }
            clearInterval(timer);
            timer = null;
            resendButton.disabled = false;
            resendButton.textContent = '重新发送';
        };

        resendButton.addEventListener('click', async function () {
            const email = getPendingEmail();
            if (!email) {
                showMessage(verifyForm, '找不到待验证的邮箱，请重新注册');
                return;
            }

            resendButton.disabled = true;
            resendButton.textContent = '发送中…';

            const result = await sb.auth.resend({ type: 'signup', email: email });

            if (result.error) {
                resendButton.disabled = false;
                resendButton.textContent = '重新发送';
                showMessage(verifyForm, translateError(result.error.message));
                return;
            }

            showMessage(verifyForm, '验证码已重新发送', 'success');
            countdown = 60;
            resendButton.textContent = countdown + ' 秒后可重发';
            timer = setInterval(tick, 1000);
        });
    }

    showPendingEmail();

    sb.auth.onAuthStateChange(function (_event, session) {
        renderAccount(session ? session.user : null);
    });

    sb.auth.getSession().then(function (result) {
        renderAccount(result.data.session ? result.data.session.user : null);
    });

    if (downloadButton) {
        downloadButton.addEventListener('click', async function () {
            if (downloadMsg) downloadMsg.textContent = '';

            const sessionResult = await sb.auth.getSession();
            if (!sessionResult.data.session) {
                if (downloadMsg) downloadMsg.textContent = '请先登录再下载';
                goPage('login');
                return;
            }

            downloadButton.disabled = true;

            const result = await sb.storage
                .from(cfg.bucket)
                .createSignedUrl(cfg.fileName, 120);

            downloadButton.disabled = false;

            if (result.error) {
                if (downloadMsg) {
                    downloadMsg.textContent = '下载失败：' + translateError(result.error.message);
                }
                return;
            }

            window.location.href = result.data.signedUrl;
        });
    }
})();