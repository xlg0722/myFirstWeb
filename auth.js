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
    const downloadButton = document.getElementById('download-latest');
    const downloadMsg = document.getElementById('download-msg');

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
        if (/Email not confirmed/i.test(message)) return '邮箱还没验证，请先完成邮箱验证';
        if (/User already registered|already confirmed/i.test(message)) return '这个邮箱已经注册过了，请直接登录';
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
                    showMessage(loginForm, '邮箱还没验证，请到注册页重新发送验证码');
                    goPage('register');
                    if (registerForm) {
                        registerForm.email.value = email;
                        registerForm.password.focus();
                    }
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
        const sendBtn = document.getElementById('send-code');
        const tokenInput = registerForm.querySelector('input[name="token"]');
        let sentEmail = '';
        let countdown = 0;
        let timer = null;

        function checkFields() {
            const email = registerForm.email.value.trim();
            const password = registerForm.password.value;
            const confirm = registerForm.confirm.value;

            if (!/^\S+@\S+\.\S+$/.test(email)) {
                showMessage(registerForm, '邮箱格式不正确');
                return null;
            }
            if (password.length < 6) {
                showMessage(registerForm, '密码至少 6 位');
                return null;
            }
            if (password !== confirm) {
                showMessage(registerForm, '两次输入的密码不一致');
                return null;
            }
            return { email: email, password: password };
        }

        function startCountdown() {
            countdown = 60;
            sendBtn.disabled = true;
            sendBtn.textContent = countdown + ' 秒后可重发';
            timer = setInterval(function () {
                countdown -= 1;
                if (countdown > 0) {
                    sendBtn.textContent = countdown + ' 秒后可重发';
                    return;
                }
                clearInterval(timer);
                timer = null;
                sendBtn.disabled = false;
                sendBtn.textContent = '重新发送';
            }, 1000);
        }

        async function sendCode() {
            const data = checkFields();
            if (!data) return;

            showMessage(registerForm, '');
            sendBtn.disabled = true;
            sendBtn.textContent = '发送中…';

            let result;
            if (sentEmail === data.email) {
                // 同一邮箱已发过码，直接重发，避免 signUp 报"已注册"
                result = await sb.auth.resend({ type: 'signup', email: data.email });
            } else {
                result = await sb.auth.signUp({
                    email: data.email,
                    password: data.password,
                    options: {
                        // 邮件里的跳转会回到当前站点
                        emailRedirectTo: location.origin + location.pathname
                    }
                });

                // 邮箱已存在时 Supabase 可能不报错而是返回空 identities，改用重发
                const exists = result.data && result.data.user &&
                    Array.isArray(result.data.user.identities) &&
                    result.data.user.identities.length === 0;

                if ((result.error && /User already registered/i.test(result.error.message)) || exists) {
                    result = await sb.auth.resend({ type: 'signup', email: data.email });
                }
            }

            if (result.error) {
                sendBtn.disabled = false;
                sendBtn.textContent = sentEmail === data.email ? '重新发送' : '发送验证码';
                showMessage(registerForm, translateError(result.error.message));
                return;
            }

            // 邮箱验证被关闭时会直接拿到 session
            if (result.data && result.data.session) {
                goPage('home');
                return;
            }

            sentEmail = data.email;
            startCountdown();
            showMessage(registerForm, '验证码已发送，请查收邮箱（含垃圾邮件箱）', 'success');
            if (tokenInput) tokenInput.focus();
        }

        sendBtn.addEventListener('click', sendCode);

        registerForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const email = registerForm.email.value.trim();
            const token = tokenInput ? tokenInput.value.replace(/\s+/g, '') : '';
            const submit = registerForm.querySelector('button[type="submit"]');

            if (!sentEmail || sentEmail !== email) {
                showMessage(registerForm, '请先点击「发送验证码」');
                return;
            }
            if (!/^\d{6,8}$/.test(token)) {
                showMessage(registerForm, '请输入 6-8 位数字验证码');
                return;
            }

            showMessage(registerForm, '');
            submit.disabled = true;
            submit.textContent = '验证中…';

            const result = await sb.auth.verifyOtp({
                email: email,
                token: token,
                type: 'signup'
            });

            submit.disabled = false;
            submit.textContent = '注册并登录';

            if (result.error) {
                showMessage(registerForm, translateError(result.error.message));
                return;
            }

            registerForm.reset();
            sentEmail = '';
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            sendBtn.disabled = false;
            sendBtn.textContent = '发送验证码';
            goPage('home');
        });
    }

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
