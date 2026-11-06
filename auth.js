/**
 * 登录 / 注册 / 会话保持 / 个人资料 / 注销账号 / 下载鉴权
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
    const navProfile = document.getElementById('nav-profile');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const profileForm = document.getElementById('profile-form');
    const deleteForm = document.getElementById('delete-form');
    const avatarButton = document.getElementById('avatar-pick');
    const avatarInput = document.getElementById('avatar-file');
    const avatarImg = document.getElementById('profile-avatar-img');
    const avatarFallback = document.getElementById('profile-avatar-fallback');
    const profileNameEl = document.getElementById('profile-name');
    const profileEmailEl = document.getElementById('profile-email');
    const downloadButton = document.getElementById('download-latest');
    const downloadMsg = document.getElementById('download-msg');

    // 好友与聊天
    const navFriends = document.getElementById('nav-friends');
    const friendsBadge = document.getElementById('friends-badge');
    const friendsView = document.getElementById('friends-view');
    const chatView = document.getElementById('chat-view');
    const friendSearchForm = document.getElementById('friend-search-form');
    const friendSearchMsg = document.getElementById('friend-search-msg');
    const friendResultsWrap = document.getElementById('friend-results-wrap');
    const friendResultsBox = document.getElementById('friend-results');
    const friendRequestsWrap = document.getElementById('friend-requests-wrap');
    const friendRequestsBox = document.getElementById('friend-requests');
    const friendsListBox = document.getElementById('friends-list');
    const friendsEmpty = document.getElementById('friends-empty');
    const chatBackBtn = document.getElementById('chat-back');
    const chatAvatar = document.getElementById('chat-avatar');
    const chatName = document.getElementById('chat-name');
    const chatScroll = document.getElementById('chat-scroll');
    const chatMessagesBox = document.getElementById('chat-messages');
    const chatEmpty = document.getElementById('chat-empty');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMsg = document.getElementById('chat-msg');
    const chatBlockBtn = document.getElementById('chat-block');
    const chatReportBtn = document.getElementById('chat-report');
    const blockedWrap = document.getElementById('blocked-wrap');
    const blockedListBox = document.getElementById('blocked-list');
    const keyExportBtn = document.getElementById('key-export');
    const keyImportBtn = document.getElementById('key-import');
    const keyFileInput = document.getElementById('key-file');
    const keyMsg = document.getElementById('key-msg');

    // 社区
    const communityForm = document.getElementById('community-form');
    const communityInput = document.getElementById('community-input');
    const communityCount = document.getElementById('community-count');
    const communityMsg = document.getElementById('community-msg');
    const communityFeed = document.getElementById('community-feed');
    const communityEmpty = document.getElementById('community-empty');
    const communityGuest = document.getElementById('community-guest');
    const communityMain = document.getElementById('community-main');

    const AVATAR_BUCKET = 'avatars';
    const AVATAR_MAX_SIZE = 2 * 1024 * 1024;
    const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    let currentUser = null;
    let currentProfile = null;

    let friends = [];            // [{ id, nickname, avatar_url, updated_at }]
    let pendingRequests = [];    // [{ id, from_id, nickname, avatar_url, updated_at }]
    let pendingOutgoing = {};    // to_id -> true
    let searchResults = [];
    let activeFriend = null;
    let unreadByFriend = {};     // friend_id -> 未读条数
    let realtimeChannel = null;
    let blockedUsers = [];       // 黑名单 [{ id, nickname, avatar_url }]
    let chatKeyCache = {};       // friend_id -> AES-GCM CryptoKey
    let localKeyPair = null;     // 本机 ECDH 密钥对

    // 社区
    let communityPosts = [];
    let communityRequestId = 0;
    let communityLoadedAt = 0;

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
        if (/Bucket not found/i.test(message)) return '头像存储桶不存在，请先完成数据库初始化';
        if (/permission denied/i.test(message)) return '数据库权限没配置好，请先执行授权脚本';
        if (/row-level security/i.test(message)) return '没有权限执行这个操作，请先完成数据库初始化';
        if (/does not exist/i.test(message)) return '数据库还没初始化，请先在 Supabase 执行初始化脚本';
        return message;
    }

    // 好友相关操作的错误提示，补上「可能还没执行初始化脚本」的指引
    function socialError(err) {
        const message = (err && err.message) || '';
        if (/Could not find the function|does not exist|schema cache/i.test(message)) {
            return '好友功能还没初始化，请先在 Supabase 执行好友初始化脚本';
        }
        if (/duplicate key/i.test(message)) return '已经发过申请了，等对方处理吧';
        return translateError(message);
    }

    function displayNameOf(user) {
        const name = ((user && user.email) || '').split('@')[0];
        return name || '玩家';
    }

    function nicknameOf() {
        if (currentProfile && currentProfile.nickname) return currentProfile.nickname;
        return displayNameOf(currentUser);
    }

    function initialOf() {
        return (nicknameOf() || '?').trim().charAt(0).toUpperCase();
    }

    // 头像地址带上资料更新时间，覆盖上传后不会读到浏览器旧缓存
    function avatarSrc() {
        if (!currentProfile || !currentProfile.avatar_url) return '';
        const base = currentProfile.avatar_url;
        const stamp = currentProfile.updated_at ? new Date(currentProfile.updated_at).getTime() : 0;
        return base + (base.indexOf('?') >= 0 ? '&' : '?') + 't=' + stamp;
    }

    function renderAccount() {
        if (!accountBox) return;
        accountBox.textContent = '';

        if (navProfile) navProfile.hidden = !currentUser;
        if (navFriends) navFriends.hidden = !currentUser;
        renderBadge();

        if (currentUser) {
            const avatar = document.createElement('a');
            avatar.href = '#profile';
            avatar.className = 'nav-avatar';
            avatar.title = '个人资料';
            avatar.setAttribute('aria-label', '个人资料');
            avatar.addEventListener('click', function (e) {
                e.preventDefault();
                goPage('profile');
            });

            const src = avatarSrc();
            if (src) {
                const img = document.createElement('img');
                img.src = src;
                img.alt = '';
                avatar.appendChild(img);
            } else {
                avatar.textContent = initialOf();
            }

            // 头像右侧显示昵称，点它也能进入个人资料
            const name = document.createElement('a');
            name.href = '#profile';
            name.className = 'nav-account__name';
            name.title = '个人资料';
            name.textContent = nicknameOf();
            name.addEventListener('click', function (e) {
                e.preventDefault();
                goPage('profile');
            });

            const logout = document.createElement('button');
            logout.type = 'button';
            logout.className = 'nav-link nav-account__logout';
            logout.dataset.action = 'logout';
            logout.textContent = '退出';

            accountBox.append(avatar, name, logout);
            return;
        }

        const login = document.createElement('a');
        login.href = '#login';
        login.className = 'nav-link';
        login.dataset.page = 'login';
        login.textContent = '登录';
        accountBox.appendChild(login);
    }

    function renderProfilePage() {
        if (!profileForm) return;

        if (!currentUser) {
            if (profileNameEl) profileNameEl.textContent = '';
            if (profileEmailEl) profileEmailEl.textContent = '';
            if (profileForm.nickname) profileForm.nickname.value = '';
            return;
        }

        const src = avatarSrc();

        if (avatarFallback) avatarFallback.textContent = initialOf();

        if (avatarImg) {
            if (src) {
                avatarImg.src = src;
                avatarImg.hidden = false;
                if (avatarFallback) avatarFallback.hidden = true;
            } else {
                avatarImg.hidden = true;
                avatarImg.removeAttribute('src');
                if (avatarFallback) avatarFallback.hidden = false;
            }
        }

        if (profileNameEl) profileNameEl.textContent = nicknameOf();
        if (profileEmailEl) profileEmailEl.textContent = currentUser.email || '';
        if (profileForm.nickname) profileForm.nickname.value = nicknameOf();
    }

    async function loadProfile(user) {
        if (!user) {
            currentProfile = null;
            return;
        }

        try {
            const result = await sb
                .from('profiles')
                .select('nickname, avatar_url, updated_at, public_key')
                .eq('id', user.id)
                .maybeSingle();

            if (result.error) throw result.error;

            if (result.data) {
                currentProfile = result.data;
                return;
            }

            // 触发器没建好时兜底：第一次登录顺手补一条资料
            const nickname = displayNameOf(user);
            const inserted = await sb
                .from('profiles')
                .insert({ id: user.id, nickname: nickname })
                .select('nickname, avatar_url, updated_at, public_key')
                .maybeSingle();

            currentProfile = inserted.data || {
                nickname: nickname,
                avatar_url: null,
                updated_at: null,
                public_key: null
            };
        } catch (err) {
            currentProfile = {
                nickname: displayNameOf(user),
                avatar_url: null,
                updated_at: null,
                public_key: null
            };
            console.warn('读取个人资料失败：', err);
        }
    }

    async function syncUser(user) {
        const previousId = currentUser ? currentUser.id : null;
        currentUser = user || null;
        await loadProfile(currentUser);
        renderAccount();
        renderProfilePage();
        renderCommunityState();

        // 登录状态变化时重新加载好友数据、重建实时订阅
        const currentId = currentUser ? currentUser.id : null;
        if (currentId !== previousId) {
            stopRealtime();
            chatKeyCache = {};
            localKeyPair = null;
            if (currentId) {
                startRealtime();
                publishPublicKey();
            }
            refreshSocial();
            communityLoadedAt = 0;
            loadCommunity();
        }

        // 退出后仍停在需要登录的页面时回到登录页
        if (!currentUser && (location.hash === '#profile' || location.hash === '#friends')) {
            goPage('login');
        }
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
            if (!/^\d{8}$/.test(token)) {
                showMessage(registerForm, '请输入 8 位数字验证码');
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

    // ===== 个人资料 =====

    if (profileForm) {
        profileForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            if (!currentUser) {
                showMessage(profileForm, '请先登录');
                goPage('login');
                return;
            }

            const nickname = profileForm.nickname.value.trim();
            if (nickname.length < 1 || nickname.length > 20) {
                showMessage(profileForm, '昵称需要 1-20 个字符');
                return;
            }

            const submit = profileForm.querySelector('button[type="submit"]');
            showMessage(profileForm, '');
            submit.disabled = true;
            submit.textContent = '保存中…';

            const result = await sb
                .from('profiles')
                .upsert({ id: currentUser.id, nickname: nickname }, { onConflict: 'id' })
                .select('nickname, avatar_url, updated_at, public_key')
                .maybeSingle();

            submit.disabled = false;
            submit.textContent = '保存昵称';

            if (result.error) {
                showMessage(profileForm, '保存失败：' + translateError(result.error.message));
                return;
            }

            if (result.data) {
                currentProfile = result.data;
            } else {
                currentProfile = {
                    nickname: nickname,
                    avatar_url: currentProfile ? currentProfile.avatar_url : null,
                    updated_at: new Date().toISOString(),
                    public_key: currentProfile ? currentProfile.public_key : null
                };
            }

            renderAccount();
            renderProfilePage();
            showMessage(profileForm, '昵称已保存', 'success');
        });
    }

    if (avatarButton && avatarInput) {
        avatarButton.addEventListener('click', function () {
            if (!currentUser) {
                goPage('login');
                return;
            }
            avatarInput.click();
        });

        avatarInput.addEventListener('change', async function () {
            const file = avatarInput.files && avatarInput.files[0];
            avatarInput.value = '';
            if (!file) return;

            if (!currentUser) {
                goPage('login');
                return;
            }

            if (AVATAR_TYPES.indexOf(file.type) === -1) {
                showMessage(profileForm, '只支持 JPG / PNG / WebP / GIF 图片');
                return;
            }
            if (file.size > AVATAR_MAX_SIZE) {
                showMessage(profileForm, '图片不能超过 2MB');
                return;
            }

            showMessage(profileForm, '');
            avatarButton.disabled = true;

            // 固定路径 + upsert：同一账号只保留一张头像，覆盖旧图
            const path = currentUser.id + '/avatar';
            const upload = await sb.storage
                .from(AVATAR_BUCKET)
                .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });

            if (upload.error) {
                avatarButton.disabled = false;
                showMessage(profileForm, '头像上传失败：' + translateError(upload.error.message));
                return;
            }

            const publicUrl = sb.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;

            const saved = await sb
                .from('profiles')
                .upsert(
                    { id: currentUser.id, nickname: nicknameOf(), avatar_url: publicUrl },
                    { onConflict: 'id' }
                )
                .select('nickname, avatar_url, updated_at, public_key')
                .maybeSingle();

            avatarButton.disabled = false;

            if (saved.error) {
                showMessage(profileForm, '头像保存失败：' + translateError(saved.error.message));
                return;
            }

            if (saved.data) currentProfile = saved.data;

            renderAccount();
            renderProfilePage();
            showMessage(profileForm, '头像已更新', 'success');
        });
    }

    // ===== 注销账号 =====

    if (deleteForm) {
        deleteForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            if (!currentUser) {
                showMessage(deleteForm, '请先登录');
                goPage('login');
                return;
            }

            const password = deleteForm.password.value;
            const confirmText = deleteForm.confirm.value.trim();

            if (confirmText !== '注销') {
                showMessage(deleteForm, '请在确认框里输入「注销」两个字');
                return;
            }
            if (!password) {
                showMessage(deleteForm, '请输入当前密码');
                return;
            }

            const submit = deleteForm.querySelector('button[type="submit"]');
            showMessage(deleteForm, '');
            submit.disabled = true;
            submit.textContent = '注销中…';

            // 先用密码重新验证身份，避免别人拿到已登录的电脑就能删号
            const check = await sb.auth.signInWithPassword({
                email: currentUser.email,
                password: password
            });

            if (check.error) {
                submit.disabled = false;
                submit.textContent = '永久注销账号';
                showMessage(deleteForm, '密码不正确，账号没有注销');
                return;
            }

            const result = await sb.rpc('delete_my_account');

            if (result.error) {
                submit.disabled = false;
                submit.textContent = '永久注销账号';
                showMessage(deleteForm, '注销失败：' + translateError(result.error.message));
                return;
            }

            try {
                await sb.auth.signOut({ scope: 'local' });
            } catch (err) {
                console.warn('退出登录失败：', err);
            }

            currentUser = null;
            currentProfile = null;
            deleteForm.reset();
            renderAccount();
            renderProfilePage();
            goPage('home');
            window.alert('账号已注销，昵称、头像和账号信息都已永久删除。');
        });
    }

    // ===== 好友与聊天 =====

    function setSocialMsg(el, text, state) {
        if (!el) return;
        el.textContent = text || '';
        el.dataset.state = text ? (state || 'error') : '';
    }

    function profileAvatarSrc(profile) {
        if (!profile || !profile.avatar_url) return '';
        const base = profile.avatar_url;
        const stamp = profile.updated_at ? new Date(profile.updated_at).getTime() : 0;
        return base + (base.indexOf('?') >= 0 ? '&' : '?') + 't=' + stamp;
    }

    function fillAvatar(el, profile, name) {
        if (!el) return;
        el.textContent = '';
        const src = profileAvatarSrc(profile);
        if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            el.appendChild(img);
            return;
        }
        el.textContent = (name || '?').trim().charAt(0).toUpperCase();
    }

    function normalizeProfile(p) {
        return {
            id: p.id,
            nickname: p.nickname || '玩家',
            avatar_url: p.avatar_url || null,
            updated_at: p.updated_at || null,
            public_key: p.public_key || null
        };
    }

    // ===== 端到端加密（ECDH P-256 + HKDF + AES-GCM） =====
    const CHAT_KEY_STORAGE = 'silogu-chat-key-v1';
    const CHAT_KEY_META = 'chat_key_v1';   // user_metadata 里的密钥备份字段
    const CHAT_ENC_ALGO = 'ecdh-p256-aesgcm-v1';
    const textEncoder = new TextEncoder();
    const textDecoder = new TextDecoder();

    function storageKeyFor(uid) {
        return CHAT_KEY_STORAGE + ':' + uid;
    }

    function bytesToBase64(bytes) {
        let binary = '';
        const arr = new Uint8Array(bytes);
        for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]);
        return btoa(binary);
    }

    function base64ToBytes(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function cryptoAvailable() {
        return !!(window.crypto && window.crypto.subtle && window.isSecureContext);
    }

    async function importPairFromJwk(privateJwk, publicJwk) {
        const privateKey = await crypto.subtle.importKey(
            'jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
        );
        const publicKey = await crypto.subtle.importKey(
            'jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []
        );
        return { privateKey: privateKey, publicKey: publicKey, publicJwk: publicJwk, privateJwk: privateJwk };
    }

    // ===== 密钥备份：自动存进账号的 user_metadata，换设备/清缓存后自动恢复 =====
    // 用户完全不需要导出/导入；同一账号在任何浏览器都会拿到同一份密钥

    function readLocalKey(uid) {
        try {
            const raw = localStorage.getItem(storageKeyFor(uid));
            if (!raw) return null;
            const saved = JSON.parse(raw);
            if (saved && saved.privateKey && saved.publicKey) return saved;
        } catch (err) {
            console.warn('读取本机密钥失败：', err);
        }
        return null;
    }

    function saveLocalKey(uid, privateJwk, publicJwk, createdAt) {
        try {
            localStorage.setItem(storageKeyFor(uid), JSON.stringify({
                version: 1,
                uid: uid,
                privateKey: privateJwk,
                publicKey: publicJwk,
                createdAt: createdAt || new Date().toISOString()
            }));
        } catch (err) {
            console.warn('保存本机密钥失败：', err);
        }
    }

    function keyFromUser(user) {
        const meta = user && user.user_metadata;
        const saved = meta && meta[CHAT_KEY_META];
        if (!saved || !saved.privateKey || !saved.publicKey) return null;
        return saved;
    }

    async function fetchCloudKey() {
        try {
            const result = await sb.auth.getUser();
            if (result.error) {
                console.warn('读取云端密钥失败：', result.error);
                return undefined;   // 读取失败（网络/鉴权）
            }
            // null 表示账号里还没有备份
            return keyFromUser(result.data && result.data.user);
        } catch (err) {
            console.warn('读取云端密钥失败：', err);
            return undefined;
        }
    }

    async function backupCloudKey(privateJwk, publicJwk) {
        try {
            const result = await sb.auth.updateUser({
                data: {
                    [CHAT_KEY_META]: {
                        privateKey: privateJwk,
                        publicKey: publicJwk,
                        createdAt: new Date().toISOString()
                    }
                }
            });
            if (result.error) console.warn('备份云端密钥失败：', result.error);
            return !result.error;
        } catch (err) {
            console.warn('备份云端密钥失败：', err);
            return false;
        }
    }

    let keyPairInitializing = null;

    // 同一时间只初始化一次，避免登录时两个入口各自生成一份密钥
    function ensureLocalKeyPair() {
        if (!currentUser) return Promise.resolve(null);
        if (localKeyPair && localKeyPair.uid === currentUser.id) return Promise.resolve(localKeyPair);
        if (!cryptoAvailable()) return Promise.resolve(null);

        if (!keyPairInitializing) {
            keyPairInitializing = initLocalKeyPair().finally(function () {
                keyPairInitializing = null;
            });
        }
        return keyPairInitializing;
    }

    async function initLocalKeyPair() {
        const uid = currentUser.id;

        // 以云端备份为准：任何设备都复用同一份密钥，不会各自生成、导致两边对不上
        const cloud = await fetchCloudKey();
        const local = readLocalKey(uid);
        let saved = local;

        if (cloud !== undefined) {
            saved = cloud || local;
        } else if (!local) {
            // 读不到云端、本机也没有密钥时先不生成：离线生成的新密钥会覆盖云端备份
            console.warn('暂时无法获取聊天密钥，请检查网络后刷新');
            return null;
        }

        if (saved) {
            try {
                const imported = await importPairFromJwk(saved.privateKey, saved.publicKey);
                if (!currentUser || currentUser.id !== uid) return null;
                localKeyPair = {
                    uid: uid,
                    privateKey: imported.privateKey,
                    publicKey: imported.publicKey,
                    publicJwk: saved.publicKey,
                    privateJwk: saved.privateKey
                };
                saveLocalKey(uid, saved.privateKey, saved.publicKey, saved.createdAt);
                // 本机有旧密钥但云端还没有备份时，顺手补传一次
                if (!cloud) await backupCloudKey(saved.privateKey, saved.publicKey);
                return localKeyPair;
            } catch (err) {
                console.warn('导入已保存的聊天密钥失败，重新生成：', err);
            }
        }

        const generated = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
        );
        const privateJwk = await crypto.subtle.exportKey('jwk', generated.privateKey);
        const publicJwk = await crypto.subtle.exportKey('jwk', generated.publicKey);
        if (!currentUser || currentUser.id !== uid) return null;

        localKeyPair = {
            uid: uid,
            privateKey: generated.privateKey,
            publicKey: generated.publicKey,
            publicJwk: publicJwk,
            privateJwk: privateJwk
        };
        saveLocalKey(uid, privateJwk, publicJwk);
        await backupCloudKey(privateJwk, publicJwk);
        return localKeyPair;
    }

    async function publishPublicKey() {
        if (!currentUser) return;
        const pair = await ensureLocalKeyPair();
        if (!pair) return;

        const keyText = JSON.stringify(pair.publicJwk);
        if (currentProfile && currentProfile.public_key === keyText) return;

        const result = await sb.from('profiles')
            .update({ public_key: keyText })
            .eq('id', currentUser.id);

        if (result.error) {
            console.warn('上传公钥失败：', result.error);
            return;
        }
        if (currentProfile) currentProfile.public_key = keyText;
    }

    async function deriveChatKey(friend) {
        if (!currentUser || !friend) throw new Error('未登录');
        if (!cryptoAvailable()) throw new Error('当前环境不支持加密聊天，请用 HTTPS 打开本站');
        if (!friend.public_key) throw new Error('对方还没有启用加密聊天，请让对方先打开一次「好友」页');

        if (chatKeyCache[friend.id]) return chatKeyCache[friend.id];

        const pair = await ensureLocalKeyPair();
        if (!pair) throw new Error('无法初始化本机密钥');

        const friendPublic = await crypto.subtle.importKey(
            'jwk', JSON.parse(friend.public_key), { name: 'ECDH', namedCurve: 'P-256' }, true, []
        );
        const sharedBits = await crypto.subtle.deriveBits(
            { name: 'ECDH', public: friendPublic }, pair.privateKey, 256
        );
        const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
        const salt = textEncoder.encode([currentUser.id, friend.id].sort().join(':'));
        const aesKey = await crypto.subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt: salt, info: textEncoder.encode('silogu-chat-v1') },
            hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );

        chatKeyCache[friend.id] = aesKey;
        return aesKey;
    }

    async function encryptMessage(key, plainText) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv }, key, textEncoder.encode(plainText)
        );
        return 'v1:' + bytesToBase64(iv) + ':' + bytesToBase64(new Uint8Array(cipher));
    }

    async function decryptMessage(key, payload) {
        const parts = String(payload).split(':');
        if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('未知的密文格式');
        const iv = base64ToBytes(parts[1]);
        const cipher = base64ToBytes(parts[2]);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipher);
        return textDecoder.decode(plain);
    }

    function renderBadge() {
        if (!friendsBadge) return;
        let total = pendingRequests.length;
        Object.keys(unreadByFriend).forEach(function (key) {
            const isFriend = friends.some(function (f) { return f.id === key; });
            if (isFriend) total += unreadByFriend[key];
        });
        friendsBadge.textContent = total > 99 ? '99+' : String(total);
        friendsBadge.hidden = !currentUser || total === 0;
        if (navFriends) navFriends.hidden = !currentUser;
    }

    function renderFriends() {
        if (!friendsListBox) return;
        friendsListBox.textContent = '';
        if (friendsEmpty) friendsEmpty.hidden = friends.length > 0;

        friends.forEach(function (friend) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'friend-item friend-item--button';
            row.dataset.friendId = friend.id;

            const avatar = document.createElement('span');
            avatar.className = 'friend-avatar';
            fillAvatar(avatar, friend, friend.nickname);

            const name = document.createElement('span');
            name.className = 'friend-name';
            name.textContent = friend.nickname;

            row.append(avatar, name);

            const unread = unreadByFriend[friend.id] || 0;
            if (unread > 0) {
                const badge = document.createElement('span');
                badge.className = 'friend-unread';
                badge.textContent = unread > 99 ? '99+' : String(unread);
                row.appendChild(badge);
            }

            friendsListBox.appendChild(row);
        });
    }

    function renderRequests() {
        if (!friendRequestsBox) return;
        friendRequestsBox.textContent = '';
        if (friendRequestsWrap) friendRequestsWrap.hidden = pendingRequests.length === 0;

        pendingRequests.forEach(function (req) {
            const row = document.createElement('div');
            row.className = 'friend-item';

            const avatar = document.createElement('span');
            avatar.className = 'friend-avatar';
            fillAvatar(avatar, req, req.nickname);

            const name = document.createElement('span');
            name.className = 'friend-name';
            name.textContent = req.nickname;

            const actions = document.createElement('span');
            actions.className = 'friend-item__actions';

            const accept = document.createElement('button');
            accept.type = 'button';
            accept.className = 'friend-action friend-action--primary';
            accept.dataset.action = 'accept-request';
            accept.dataset.requestId = req.requestId;
            accept.textContent = '接受';

            const reject = document.createElement('button');
            reject.type = 'button';
            reject.className = 'friend-action';
            reject.dataset.action = 'reject-request';
            reject.dataset.requestId = req.requestId;
            reject.textContent = '忽略';

            actions.append(accept, reject);
            row.append(avatar, name, actions);
            friendRequestsBox.appendChild(row);
        });
    }

    function renderSearchResults() {
        if (!friendResultsBox) return;
        friendResultsBox.textContent = '';
        if (friendResultsWrap) friendResultsWrap.hidden = searchResults.length === 0;

        searchResults.forEach(function (person) {
            const row = document.createElement('div');
            row.className = 'friend-item';

            const avatar = document.createElement('span');
            avatar.className = 'friend-avatar';
            fillAvatar(avatar, person, person.nickname);

            const name = document.createElement('span');
            name.className = 'friend-name';
            name.textContent = person.emailMatch ? '邮箱匹配的用户（添加后可见昵称）' : person.nickname;

            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'friend-action';

            const isMe = currentUser && person.id === currentUser.id;
            const isFriend = friends.some(function (f) { return f.id === person.id; });
            const isPending = !!pendingOutgoing[person.id];

            if (isMe) {
                action.textContent = '你自己';
                action.disabled = true;
            } else if (isFriend) {
                action.textContent = '已是好友';
                action.disabled = true;
            } else if (isPending) {
                action.textContent = '已申请';
                action.disabled = true;
            } else {
                action.textContent = '加好友';
                action.dataset.action = 'add-friend';
                action.dataset.userId = person.id;
            }

            row.append(avatar, name, action);
            friendResultsBox.appendChild(row);
        });
    }

    async function loadFriends() {
        if (!currentUser) {
            friends = [];
            renderFriends();
            return;
        }

        const rel = await sb.from('friendships').select('friend_id').eq('user_id', currentUser.id);
        if (rel.error) {
            console.warn('读取好友列表失败：', rel.error);
            friends = [];
            renderFriends();
            return;
        }

        const ids = (rel.data || []).map(function (r) { return r.friend_id; });
        if (!ids.length) {
            friends = [];
            renderFriends();
            return;
        }

        const prof = await sb.from('profiles')
            .select('id, nickname, avatar_url, updated_at, public_key')
            .in('id', ids);

        if (prof.error) console.warn('读取好友资料失败：', prof.error);

        const map = {};
        (prof.data || []).forEach(function (p) { map[p.id] = p; });

        // 记下旧公钥，只有对方换了密钥设备时才丢弃对应的聊天密钥缓存
        const previousKeys = {};
        friends.forEach(function (f) { previousKeys[f.id] = f.public_key; });

        friends = ids.map(function (id) {
            return normalizeProfile(map[id] || { id: id });
        }).sort(function (a, b) {
            return a.nickname.localeCompare(b.nickname, 'zh-CN');
        });

        friends.forEach(function (f) {
            if (previousKeys[f.id] && previousKeys[f.id] !== f.public_key) {
                delete chatKeyCache[f.id];
            }
        });

        if (activeFriend) {
            const fresh = friends.find(function (f) { return f.id === activeFriend.id; });
            if (fresh) activeFriend = fresh;
        }

        renderFriends();
        renderBadge();
    }

    async function loadRequests() {
        pendingOutgoing = {};
        pendingRequests = [];

        if (!currentUser) {
            renderRequests();
            renderBadge();
            return;
        }

        // 已发出的申请和收到的申请并行查询，少一次往返
        const results = await Promise.all([
            sb.from('friend_requests')
                .select('to_id')
                .eq('from_id', currentUser.id)
                .eq('status', 'pending'),
            sb.from('friend_requests')
                .select('id, from_id, created_at')
                .eq('to_id', currentUser.id)
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
        ]);

        const outgoing = results[0];
        const list = results[1];

        if (outgoing.error) console.warn('读取已发申请失败：', outgoing.error);
        (outgoing.data || []).forEach(function (r) { pendingOutgoing[r.to_id] = true; });

        if (list.error) {
            console.warn('读取好友申请失败：', list.error);
            renderRequests();
            renderBadge();
            return;
        }

        const senderIds = (list.data || []).map(function (r) { return r.from_id; });
        let profiles = [];
        if (senderIds.length) {
            const prof = await sb.from('profiles')
                .select('id, nickname, avatar_url, updated_at')
                .in('id', senderIds);
            if (prof.error) console.warn('读取申请人资料失败：', prof.error);
            profiles = prof.data || [];
        }

        const map = {};
        profiles.forEach(function (p) { map[p.id] = p; });

        pendingRequests = (list.data || []).map(function (r) {
            const result = normalizeProfile(map[r.from_id] || { id: r.from_id });
            result.id = map[r.from_id] ? map[r.from_id].id : r.from_id;
            result.requestId = r.id;
            result.from_id = r.from_id;
            result.created_at = r.created_at;
            return result;
        });

        renderRequests();
        renderBadge();
    }

    async function loadUnread() {
        unreadByFriend = {};

        if (!currentUser) {
            renderBadge();
            return;
        }

        const result = await sb.from('messages')
            .select('sender_id')
            .eq('receiver_id', currentUser.id)
            .is('read_at', null)
            .limit(1000);

        if (result.error) {
            console.warn('读取未读消息失败：', result.error);
            renderBadge();
            return;
        }

        (result.data || []).forEach(function (m) {
            unreadByFriend[m.sender_id] = (unreadByFriend[m.sender_id] || 0) + 1;
        });

        renderBadge();
    }

    async function loadBlocked() {
        blockedUsers = [];
        if (!currentUser) {
            renderBlocked();
            return;
        }

        const result = await sb.rpc('list_blocked_users');
        if (result.error) {
            console.warn('读取黑名单失败：', result.error);
            renderBlocked();
            return;
        }

        blockedUsers = (result.data || []).map(normalizeProfile);
        renderBlocked();
    }

    function renderBlocked() {
        if (!blockedListBox) return;
        blockedListBox.textContent = '';
        if (blockedWrap) blockedWrap.hidden = blockedUsers.length === 0;

        blockedUsers.forEach(function (person) {
            const row = document.createElement('div');
            row.className = 'friend-item';

            const avatar = document.createElement('span');
            avatar.className = 'friend-avatar';
            fillAvatar(avatar, person, person.nickname);

            const name = document.createElement('span');
            name.className = 'friend-name';
            name.textContent = person.nickname;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'friend-action';
            button.dataset.action = 'unblock-user';
            button.dataset.userId = person.id;
            button.textContent = '解除拉黑';

            row.append(avatar, name, button);
            blockedListBox.appendChild(row);
        });
    }

    let socialRefreshing = null;   // 正在进行的刷新，避免重复请求
    let socialLoadedAt = 0;        // 上次刷新完成时间

    async function refreshSocial() {
        if (!currentUser) {
            friends = [];
            pendingRequests = [];
            pendingOutgoing = {};
            searchResults = [];
            unreadByFriend = {};
            blockedUsers = [];
            renderFriends();
            renderRequests();
            renderSearchResults();
            renderBlocked();
            renderBadge();
            closeChat();
            return;
        }

        if (socialRefreshing) return socialRefreshing;

        socialRefreshing = Promise.all([
            loadFriends(),
            loadRequests(),
            loadUnread(),
            loadBlocked()
        ]).then(function () {
            socialLoadedAt = Date.now();
        }).finally(function () {
            socialRefreshing = null;
        });

        return socialRefreshing;
    }

    function stopRealtime() {
        if (realtimeChannel) {
            sb.removeChannel(realtimeChannel);
            realtimeChannel = null;
        }
    }

    let messageReloadTimer = null;
    let unreadReloadTimer = null;
    let requestsReloadTimer = null;

    // 实时推送可能短时间连发多条，合并成一次刷新
    function scheduleMessageReload() {
        clearTimeout(messageReloadTimer);
        messageReloadTimer = setTimeout(function () { loadMessages(); }, 250);
    }

    function scheduleUnreadReload() {
        clearTimeout(unreadReloadTimer);
        unreadReloadTimer = setTimeout(function () { loadUnread(); }, 400);
    }

    function scheduleRequestsReload() {
        clearTimeout(requestsReloadTimer);
        requestsReloadTimer = setTimeout(function () { loadRequests(); }, 400);
    }

    function startRealtime() {
        stopRealtime();
        if (!currentUser) return;

        const me = currentUser.id;

        realtimeChannel = sb.channel('social-' + me)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: 'receiver_id=eq.' + me
            }, function (payload) {
                const msg = payload.new;
                if (activeFriend && msg.sender_id === activeFriend.id) {
                    scheduleMessageReload();
                    markChatRead();
                } else {
                    scheduleUnreadReload();
                }
            })
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: 'sender_id=eq.' + me
            }, function (payload) {
                if (activeFriend && payload.new.receiver_id === activeFriend.id) {
                    scheduleMessageReload();
                }
            })
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'friend_requests',
                filter: 'to_id=eq.' + me
            }, function () {
                scheduleRequestsReload();
            })
            .subscribe();
    }

    function formatMessageTime(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const now = new Date();
        const minutes = d.getMinutes() < 10 ? '0' + d.getMinutes() : String(d.getMinutes());
        const hm = d.getHours() + ':' + minutes;
        if (d.toDateString() === now.toDateString()) return hm;
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
    }

    function scrollChatToBottom() {
        if (chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight;
    }

    async function renderMessages(list) {
        if (!chatMessagesBox) return;

        let aesKey = null;
        if (activeFriend) {
            try {
                aesKey = await deriveChatKey(activeFriend);
            } catch (err) {
                console.warn('派生聊天密钥失败：', err.message);
            }
        }

        // 并行解密，避免 200 条消息一条条排队
        const texts = await Promise.all(list.map(function (m) {
            if (!m.enc_algo) return Promise.resolve(m.content);
            if (!aesKey) return Promise.resolve('（这条旧消息无法显示）');
            return decryptMessage(aesKey, m.content).catch(function () {
                return '（这条旧消息无法显示）';
            });
        }));

        const frag = document.createDocumentFragment();
        const meId = currentUser ? currentUser.id : null;

        list.forEach(function (m, index) {
            const row = document.createElement('div');
            row.className = 'chat-row' + (m.sender_id === meId ? ' chat-row--mine' : '');

            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble';
            bubble.textContent = texts[index];

            const time = document.createElement('span');
            time.className = 'chat-time';
            time.textContent = formatMessageTime(m.created_at);

            row.append(bubble, time);
            frag.appendChild(row);
        });

        chatMessagesBox.textContent = '';
        chatMessagesBox.appendChild(frag);
        if (chatEmpty) chatEmpty.hidden = list.length > 0;

        scrollChatToBottom();
    }

    // 对方可能换过设备，聊天前拉一次最新公钥，避免继续用旧公钥加密/解密
    async function refreshFriendKey(friend) {
        if (!currentUser || !friend) return friend;
        try {
            const result = await sb.from('profiles')
                .select('public_key')
                .eq('id', friend.id)
                .maybeSingle();

            if (result.error || !result.data) return friend;
            const latest = result.data.public_key || null;
            if (latest !== friend.public_key) {
                friend.public_key = latest;
                delete chatKeyCache[friend.id];
                const inList = friends.find(function (f) { return f.id === friend.id; });
                if (inList) inList.public_key = latest;
                if (activeFriend && activeFriend.id === friend.id) activeFriend.public_key = latest;
            }
        } catch (err) {
            console.warn('刷新好友公钥失败：', err);
        }
        return friend;
    }

    async function loadMessages() {
        if (!currentUser || !activeFriend) return;

        const target = activeFriend;
        const keyRefresh = refreshFriendKey(target);
        const me = currentUser.id;
        const other = target.id;
        const filter = 'and(sender_id.eq.' + me + ',receiver_id.eq.' + other + ')' +
            ',and(sender_id.eq.' + other + ',receiver_id.eq.' + me + ')';

        const result = await sb.from('messages')
            .select('id, sender_id, receiver_id, content, created_at, enc_algo')
            .or(filter)
            .order('created_at', { ascending: false })
            .limit(200);

        // 公钥查询和消息查询并行，尽量不额外增加打开聊天的等待
        await keyRefresh;

        if (result.error) {
            setSocialMsg(chatMsg, '消息加载失败：' + socialError(result.error));
            return;
        }

        setSocialMsg(chatMsg, '');
        // 取最近 200 条后再正序展示
        await renderMessages((result.data || []).slice().reverse());
    }

    async function markChatRead() {
        if (!currentUser || !activeFriend) return;

        const result = await sb.from('messages')
            .update({ read_at: new Date().toISOString() })
            .eq('receiver_id', currentUser.id)
            .eq('sender_id', activeFriend.id)
            .is('read_at', null);

        if (result.error) console.warn('标记已读失败：', result.error);
        scheduleUnreadReload();
    }

    function openChat(friend) {
        activeFriend = friend;
        if (friendsView) friendsView.hidden = true;
        if (chatView) chatView.hidden = false;
        if (chatName) chatName.textContent = friend.nickname;
        fillAvatar(chatAvatar, friend, friend.nickname);
        if (chatMessagesBox) chatMessagesBox.textContent = '';
        if (chatEmpty) chatEmpty.hidden = true;
        setSocialMsg(chatMsg, '');
        if (!friend.public_key) {
            setSocialMsg(chatMsg, '对方还没启用加密聊天，暂时发不出消息；让对方打开一次「好友」页即可');
        }
        if (chatInput) chatInput.value = '';

        // 先把本会话未读清零，红点立即消失，不等待网络
        if (unreadByFriend[friend.id]) {
            unreadByFriend[friend.id] = 0;
            renderBadge();
            renderFriends();
        }

        // 标记已读与拉消息并行，不再串成一条长链
        markChatRead();
        loadMessages().then(function () {
            if (chatInput) chatInput.focus();
        });
    }

    function closeChat() {
        activeFriend = null;
        if (chatView) chatView.hidden = true;
        if (friendsView) friendsView.hidden = false;
    }

    async function addFriend(userId, button) {
        if (!currentUser) {
            goPage('login');
            return;
        }

        button.disabled = true;
        const result = await sb.rpc('send_friend_request', { p_to: userId });

        if (result.error) {
            button.disabled = false;
            setSocialMsg(friendSearchMsg, '发送失败：' + socialError(result.error));
            return;
        }

        if (result.data === 'accepted') {
            setSocialMsg(friendSearchMsg, '对方之前也申请过你，已经直接成为好友', 'success');
            await refreshSocial();
            renderSearchResults();
            return;
        }
        if (result.data === 'already_friends') {
            setSocialMsg(friendSearchMsg, '你们已经是好友了', 'success');
            await refreshSocial();
            renderSearchResults();
            return;
        }

        pendingOutgoing[userId] = true;
        setSocialMsg(friendSearchMsg, '好友申请已发送，等对方同意', 'success');
        renderSearchResults();
    }

    if (friendSearchForm) {
        friendSearchForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            if (!currentUser) {
                goPage('login');
                return;
            }

            const query = friendSearchForm.query.value.trim();
            setSocialMsg(friendSearchMsg, '');

            if (!query) {
                setSocialMsg(friendSearchMsg, '请输入昵称或完整邮箱');
                return;
            }

            const byEmail = query.indexOf('@') >= 0;
            if (!byEmail && query.length < 2) {
                setSocialMsg(friendSearchMsg, '昵称至少输入 2 个字符');
                return;
            }

            const submit = friendSearchForm.querySelector('button[type="submit"]');
            submit.disabled = true;
            submit.textContent = '搜索中…';

            let rows = [];
            if (byEmail) {
                const result = await sb.rpc('find_user_by_email', { p_email: query });
                if (result.error) {
                    submit.disabled = false;
                    submit.textContent = '搜索';
                    setSocialMsg(friendSearchMsg, '搜索失败：' + socialError(result.error));
                    return;
                }
                // 邮箱只返回账号 id，昵称和头像在加好友后才可见
                rows = (result.data || []).map(function (row) {
                    return {
                        id: row.id,
                        nickname: '邮箱匹配的用户',
                        avatar_url: null,
                        updated_at: null,
                        public_key: null,
                        emailMatch: true
                    };
                });
            } else {
                const result = await sb.rpc('search_users', { p_query: query });

                if (result.error) {
                    submit.disabled = false;
                    submit.textContent = '搜索';
                    setSocialMsg(friendSearchMsg, '搜索失败：' + socialError(result.error));
                    return;
                }
                rows = result.data || [];
            }

            submit.disabled = false;
            submit.textContent = '搜索';

            searchResults = rows.map(function (row) {
                const person = normalizeProfile(row);
                person.emailMatch = !!row.emailMatch;
                return person;
            });
            renderSearchResults();

            if (!searchResults.length) {
                setSocialMsg(friendSearchMsg, '没有找到匹配的用户');
            } else {
                setSocialMsg(friendSearchMsg, '找到 ' + searchResults.length + ' 个用户', 'success');
            }
        });
    }

    if (friendResultsBox) {
        friendResultsBox.addEventListener('click', function (e) {
            const button = e.target.closest('[data-action="add-friend"]');
            if (!button) return;
            addFriend(button.dataset.userId, button);
        });
    }

    if (friendRequestsBox) {
        friendRequestsBox.addEventListener('click', async function (e) {
            const acceptButton = e.target.closest('[data-action="accept-request"]');
            const rejectButton = e.target.closest('[data-action="reject-request"]');
            if (!acceptButton && !rejectButton) return;

            const button = acceptButton || rejectButton;
            const requestId = button.dataset.requestId;
            button.disabled = true;

            if (acceptButton) {
                const result = await sb.rpc('accept_friend_request', { p_request_id: requestId });
                if (result.error) {
                    button.disabled = false;
                    setSocialMsg(friendSearchMsg, '接受失败：' + socialError(result.error));
                    return;
                }
                setSocialMsg(friendSearchMsg, '已接受好友申请', 'success');
            } else {
                const result = await sb.from('friend_requests')
                    .update({ status: 'rejected' })
                    .eq('id', requestId)
                    .eq('to_id', currentUser.id);
                if (result.error) {
                    button.disabled = false;
                    setSocialMsg(friendSearchMsg, '操作失败：' + socialError(result.error));
                    return;
                }
                setSocialMsg(friendSearchMsg, '已忽略该申请');
            }

            await refreshSocial();
            renderSearchResults();
        });
    }

    if (friendsListBox) {
        friendsListBox.addEventListener('click', function (e) {
            const button = e.target.closest('[data-friend-id]');
            if (!button) return;
            const friend = friends.find(function (f) { return f.id === button.dataset.friendId; });
            if (friend) openChat(friend);
        });
    }

    if (chatBackBtn) {
        chatBackBtn.addEventListener('click', function () {
            closeChat();
            refreshSocial();
        });
    }

    if (chatForm) {
        chatForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            if (!currentUser) {
                goPage('login');
                return;
            }
            if (!activeFriend) return;

            const text = chatInput.value.trim();
            if (!text) return;
            if (text.length > 2000) {
                setSocialMsg(chatMsg, '消息最多 2000 个字');
                return;
            }

            let aesKey;
            try {
                await refreshFriendKey(activeFriend);
                aesKey = await deriveChatKey(activeFriend);
            } catch (err) {
                setSocialMsg(chatMsg, '发送失败：' + err.message);
                return;
            }

            const submit = chatForm.querySelector('button[type="submit"]');
            submit.disabled = true;

            let cipherText;
            try {
                cipherText = await encryptMessage(aesKey, text);
            } catch (err) {
                submit.disabled = false;
                setSocialMsg(chatMsg, '加密失败：' + (err.message || '当前浏览器不支持'));
                return;
            }

            const result = await sb.from('messages').insert({
                sender_id: currentUser.id,
                receiver_id: activeFriend.id,
                content: cipherText,
                enc_algo: CHAT_ENC_ALGO
            });

            submit.disabled = false;

            if (result.error) {
                setSocialMsg(chatMsg, '发送失败：' + socialError(result.error));
                return;
            }

            chatInput.value = '';
            setSocialMsg(chatMsg, '');
            await loadMessages();
        });

        // 回车发送，Shift+回车换行
        chatInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (typeof chatForm.requestSubmit === 'function') {
                    chatForm.requestSubmit();
                } else {
                    chatForm.querySelector('button[type="submit"]').click();
                }
            }
        });
    }

    async function blockActiveFriend() {
        if (!currentUser || !activeFriend) return;

        const name = activeFriend.nickname;
        if (!window.confirm('确定拉黑「' + name + '」吗？拉黑后双方不能再发消息，好友关系会解除。')) return;

        chatBlockBtn.disabled = true;
        const result = await sb.rpc('block_user', { p_target: activeFriend.id });
        chatBlockBtn.disabled = false;

        if (result.error) {
            setSocialMsg(chatMsg, '拉黑失败：' + socialError(result.error));
            return;
        }

        chatKeyCache = {};
        closeChat();
        await refreshSocial();
        setSocialMsg(friendSearchMsg, '已拉黑「' + name + '」', 'success');
    }

    async function reportActiveFriend() {
        if (!currentUser || !activeFriend) return;

        const name = activeFriend.nickname;
        const input = window.prompt('举报「' + name + '」，请填写理由（最多 500 字）');
        if (input === null) return;

        const reason = input.trim();
        if (!reason) {
            setSocialMsg(chatMsg, '举报理由不能为空');
            return;
        }
        if (reason.length > 500) {
            setSocialMsg(chatMsg, '举报理由最多 500 字');
            return;
        }

        chatReportBtn.disabled = true;
        const result = await sb.rpc('report_user', { p_target: activeFriend.id, p_reason: reason });
        chatReportBtn.disabled = false;

        if (result.error) {
            setSocialMsg(chatMsg, '举报失败：' + socialError(result.error));
            return;
        }
        setSocialMsg(chatMsg, '举报已提交，我们会尽快处理', 'success');
    }

    async function exportChatKey() {
        if (!currentUser) {
            goPage('login');
            return;
        }

        setSocialMsg(keyMsg, '');
        const pair = await ensureLocalKeyPair();
        if (!pair || !pair.privateJwk) {
            setSocialMsg(keyMsg, '当前环境不支持导出密钥');
            return;
        }

        const payload = {
            type: 'silogu-chat-key',
            version: 1,
            uid: currentUser.id,
            privateKey: pair.privateJwk,
            publicKey: pair.publicJwk,
            exportedAt: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'silogu-chat-key-' + currentUser.id.slice(0, 8) + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
        setSocialMsg(keyMsg, '密钥已导出，请妥善保管', 'success');
    }

    async function importChatKey(file) {
        if (!currentUser) {
            goPage('login');
            return;
        }

        setSocialMsg(keyMsg, '');
        try {
            const data = JSON.parse(await file.text());

            if (!data || data.type !== 'silogu-chat-key' || !data.privateKey || !data.publicKey) {
                setSocialMsg(keyMsg, '文件不是有效的密钥备份');
                return;
            }
            if (data.uid !== currentUser.id) {
                setSocialMsg(keyMsg, '这份密钥属于另一个账号，不能导入');
                return;
            }

            const pair = await importPairFromJwk(data.privateKey, data.publicKey);
            localStorage.setItem(storageKeyFor(currentUser.id), JSON.stringify({
                version: 1,
                uid: currentUser.id,
                privateKey: data.privateKey,
                publicKey: data.publicKey,
                createdAt: new Date().toISOString()
            }));
            localKeyPair = {
                uid: currentUser.id,
                privateKey: pair.privateKey,
                publicKey: pair.publicKey,
                publicJwk: data.publicKey,
                privateJwk: data.privateKey
            };
            chatKeyCache = {};

            // 导入的密钥同步到账号备份，换设备后也能直接用
            await backupCloudKey(data.privateKey, data.publicKey);
            await publishPublicKey();
            if (activeFriend) await loadMessages();

            setSocialMsg(keyMsg, '密钥已导入', 'success');
        } catch (err) {
            setSocialMsg(keyMsg, '导入失败：' + ((err && err.message) || '文件格式不正确'));
        }
    }

    if (chatBlockBtn) {
        chatBlockBtn.addEventListener('click', blockActiveFriend);
    }

    if (chatReportBtn) {
        chatReportBtn.addEventListener('click', reportActiveFriend);
    }

    if (blockedListBox) {
        blockedListBox.addEventListener('click', async function (e) {
            const button = e.target.closest('[data-action="unblock-user"]');
            if (!button) return;

            button.disabled = true;
            const result = await sb.rpc('unblock_user', { p_target: button.dataset.userId });
            if (result.error) {
                button.disabled = false;
                setSocialMsg(friendSearchMsg, '解除拉黑失败：' + socialError(result.error));
                return;
            }

            await loadBlocked();
            setSocialMsg(friendSearchMsg, '已解除拉黑，对方需要重新加好友', 'success');
        });
    }

    // ===== 社区 =====

    function communityError(err) {
        const message = (err && err.message) || '';
        if (/Could not find the table|relation .* does not exist|does not exist|schema cache/i.test(message)) {
            return '社区还没初始化，请先在 Supabase 执行社区初始化脚本';
        }
        return socialError(err);
    }

    function renderCommunityState() {
        const loggedIn = !!currentUser;
        if (communityGuest) communityGuest.hidden = loggedIn;
        if (communityMain) communityMain.hidden = !loggedIn;
    }

    function renderCommunityPosts() {
        if (!communityFeed) return;
        communityFeed.textContent = '';
        if (communityEmpty) communityEmpty.hidden = communityPosts.length > 0;

        communityPosts.forEach(function (post) {
            const item = document.createElement('div');
            item.className = 'community-post';

            const head = document.createElement('div');
            head.className = 'community-post__head';

            const avatar = document.createElement('span');
            avatar.className = 'friend-avatar';
            fillAvatar(avatar, post.author, post.author.nickname);

            const meta = document.createElement('div');
            meta.className = 'community-post__meta';

            const name = document.createElement('span');
            name.className = 'community-post__name';
            name.textContent = post.author.nickname;

            const time = document.createElement('span');
            time.className = 'community-post__time';
            time.textContent = formatMessageTime(post.created_at);

            meta.append(name, time);
            head.append(avatar, meta);

            const text = document.createElement('p');
            text.className = 'community-post__text';
            text.textContent = post.content;

            item.append(head, text);
            communityFeed.appendChild(item);
        });
    }

    async function loadCommunity(force) {
        renderCommunityState();

        if (!currentUser) {
            communityPosts = [];
            renderCommunityPosts();
            return;
        }
        if (!force && communityLoadedAt && Date.now() - communityLoadedAt < 10000) return;

        const reqId = ++communityRequestId;

        const result = await sb
            .from('community_posts')
            .select('id, content, created_at, author_id')
            .order('created_at', { ascending: false })
            .limit(60);

        if (reqId !== communityRequestId) return;

        if (result.error) {
            communityPosts = [];
            renderCommunityPosts();
            setSocialMsg(communityMsg, communityError(result.error));
            return;
        }

        const rows = result.data || [];
        const authorIds = [];
        rows.forEach(function (row) {
            if (row.author_id && authorIds.indexOf(row.author_id) < 0) authorIds.push(row.author_id);
        });

        let authors = {};
        if (authorIds.length) {
            const people = await sb
                .from('profiles')
                .select('id, nickname, avatar_url, updated_at')
                .in('id', authorIds);

            if (reqId !== communityRequestId) return;

            if (!people.error) {
                (people.data || []).forEach(function (person) {
                    authors[person.id] = normalizeProfile(person);
                });
            }
        }

        communityPosts = rows.map(function (row) {
            return {
                id: row.id,
                content: row.content,
                created_at: row.created_at,
                author: authors[row.author_id] || {
                    id: row.author_id,
                    nickname: '玩家',
                    avatar_url: null,
                    updated_at: null,
                    public_key: null
                }
            };
        });

        communityLoadedAt = Date.now();
        renderCommunityPosts();
        setSocialMsg(communityMsg, '');
    }

    function updateCommunityCount() {
        if (!communityCount || !communityInput) return;
        communityCount.textContent = communityInput.value.length + '/500';
    }

    if (communityInput) {
        communityInput.addEventListener('input', updateCommunityCount);
    }

    if (communityForm) {
        communityForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            if (!currentUser) {
                setSocialMsg(communityMsg, '登录后才能发布消息');
                return;
            }

            const text = (communityInput.value || '').trim();
            if (!text) {
                setSocialMsg(communityMsg, '先写点什么再发布');
                return;
            }
            if (text.length > 500) {
                setSocialMsg(communityMsg, '一条消息最多 500 个字');
                return;
            }

            const submit = communityForm.querySelector('button[type="submit"]');
            submit.disabled = true;
            submit.textContent = '发布中…';
            setSocialMsg(communityMsg, '');

            const result = await sb.from('community_posts').insert({
                author_id: currentUser.id,
                content: text
            });

            submit.disabled = false;
            submit.textContent = '发布';

            if (result.error) {
                setSocialMsg(communityMsg, communityError(result.error));
                return;
            }

            communityInput.value = '';
            updateCommunityCount();
            setSocialMsg(communityMsg, '已发布', 'success');
            await loadCommunity(true);
        });
    }

    if (keyExportBtn) {
        keyExportBtn.addEventListener('click', exportChatKey);
    }

    if (keyImportBtn && keyFileInput) {
        keyImportBtn.addEventListener('click', function () {
            keyFileInput.click();
        });
        keyFileInput.addEventListener('change', function () {
            const file = keyFileInput.files && keyFileInput.files[0];
            keyFileInput.value = '';
            if (file) importChatKey(file);
        });
    }

    window.addEventListener('silgu:page', function (e) {
        const name = e.detail && e.detail.name;

        if (name === 'community') {
            loadCommunity();
            return;
        }

        if (name !== 'friends') return;

        if (!currentUser) {
            goPage('login');
            return;
        }

        // 已经在刷新，或 15 秒内刚刷新过，就不再重复打一轮接口
        if (socialRefreshing) return;
        if (socialLoadedAt && Date.now() - socialLoadedAt < 15000) return;

        refreshSocial();
    });

    sb.auth.onAuthStateChange(function () {
        // 回调里直接调用其它 supabase 方法可能死锁，延后到当前事件结束
        setTimeout(function () {
            sb.auth.getSession().then(function (result) {
                syncUser(result.data.session ? result.data.session.user : null);
            });
        }, 0);
    });

    sb.auth.getSession().then(function (result) {
        syncUser(result.data.session ? result.data.session.user : null);
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
