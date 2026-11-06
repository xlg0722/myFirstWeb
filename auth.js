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
                .select('nickname, avatar_url, updated_at')
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
                .select('nickname, avatar_url, updated_at')
                .maybeSingle();

            currentProfile = inserted.data || {
                nickname: nickname,
                avatar_url: null,
                updated_at: null
            };
        } catch (err) {
            currentProfile = {
                nickname: displayNameOf(user),
                avatar_url: null,
                updated_at: null
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

        // 登录状态变化时重新加载好友数据、重建实时订阅
        const currentId = currentUser ? currentUser.id : null;
        if (currentId !== previousId) {
            stopRealtime();
            if (currentId) startRealtime();
            refreshSocial();
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
                .select('nickname, avatar_url, updated_at')
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
                    updated_at: new Date().toISOString()
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
                .select('nickname, avatar_url, updated_at')
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
            updated_at: p.updated_at || null
        };
    }

    function renderBadge() {
        if (!friendsBadge) return;
        let total = pendingRequests.length;
        Object.keys(unreadByFriend).forEach(function (key) {
            total += unreadByFriend[key];
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
            name.textContent = person.nickname;

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
            .select('id, nickname, avatar_url, updated_at')
            .in('id', ids);

        if (prof.error) console.warn('读取好友资料失败：', prof.error);

        const map = {};
        (prof.data || []).forEach(function (p) { map[p.id] = p; });

        friends = ids.map(function (id) {
            return normalizeProfile(map[id] || { id: id });
        }).sort(function (a, b) {
            return a.nickname.localeCompare(b.nickname, 'zh-CN');
        });

        if (activeFriend) {
            const fresh = friends.find(function (f) { return f.id === activeFriend.id; });
            if (fresh) activeFriend = fresh;
        }

        renderFriends();
    }

    async function loadRequests() {
        pendingOutgoing = {};
        pendingRequests = [];

        if (!currentUser) {
            renderRequests();
            renderBadge();
            return;
        }

        const outgoing = await sb.from('friend_requests')
            .select('to_id')
            .eq('from_id', currentUser.id)
            .eq('status', 'pending');

        if (outgoing.error) console.warn('读取已发申请失败：', outgoing.error);
        (outgoing.data || []).forEach(function (r) { pendingOutgoing[r.to_id] = true; });

        const list = await sb.from('friend_requests')
            .select('id, from_id, created_at')
            .eq('to_id', currentUser.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

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
        renderFriends();
    }

    async function refreshSocial() {
        if (!currentUser) {
            friends = [];
            pendingRequests = [];
            pendingOutgoing = {};
            searchResults = [];
            unreadByFriend = {};
            renderFriends();
            renderRequests();
            renderSearchResults();
            renderBadge();
            closeChat();
            return;
        }

        await Promise.all([loadFriends(), loadRequests(), loadUnread()]);
    }

    function stopRealtime() {
        if (realtimeChannel) {
            sb.removeChannel(realtimeChannel);
            realtimeChannel = null;
        }
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
                    loadMessages();
                    markChatRead();
                } else {
                    loadUnread();
                }
            })
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: 'sender_id=eq.' + me
            }, function (payload) {
                if (activeFriend && payload.new.receiver_id === activeFriend.id) {
                    loadMessages();
                }
            })
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'friend_requests',
                filter: 'to_id=eq.' + me
            }, function () {
                loadRequests();
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

    function renderMessages(list) {
        if (!chatMessagesBox) return;
        chatMessagesBox.textContent = '';
        if (chatEmpty) chatEmpty.hidden = list.length > 0;

        list.forEach(function (m) {
            const row = document.createElement('div');
            row.className = 'chat-row' + (m.sender_id === currentUser.id ? ' chat-row--mine' : '');

            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble';
            bubble.textContent = m.content;

            const time = document.createElement('span');
            time.className = 'chat-time';
            time.textContent = formatMessageTime(m.created_at);

            row.append(bubble, time);
            chatMessagesBox.appendChild(row);
        });

        scrollChatToBottom();
    }

    async function loadMessages() {
        if (!currentUser || !activeFriend) return;

        const me = currentUser.id;
        const other = activeFriend.id;
        const filter = 'and(sender_id.eq.' + me + ',receiver_id.eq.' + other + ')' +
            ',and(sender_id.eq.' + other + ',receiver_id.eq.' + me + ')';

        const result = await sb.from('messages')
            .select('id, sender_id, receiver_id, content, created_at')
            .or(filter)
            .order('created_at', { ascending: false })
            .limit(200);

        if (result.error) {
            setSocialMsg(chatMsg, '消息加载失败：' + socialError(result.error));
            return;
        }

        setSocialMsg(chatMsg, '');
        // 取最近 200 条后再正序展示
        renderMessages((result.data || []).slice().reverse());
    }

    async function markChatRead() {
        if (!currentUser || !activeFriend) return;

        const result = await sb.from('messages')
            .update({ read_at: new Date().toISOString() })
            .eq('receiver_id', currentUser.id)
            .eq('sender_id', activeFriend.id)
            .is('read_at', null);

        if (result.error) console.warn('标记已读失败：', result.error);
        await loadUnread();
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
        if (chatInput) chatInput.value = '';

        markChatRead().then(loadMessages).then(function () {
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
                rows = result.data || [];
            } else {
                const result = await sb.from('profiles')
                    .select('id, nickname, avatar_url, updated_at')
                    .ilike('nickname', '%' + query + '%')
                    .limit(20);

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

            searchResults = rows.map(normalizeProfile);
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

            const submit = chatForm.querySelector('button[type="submit"]');
            submit.disabled = true;

            const result = await sb.from('messages').insert({
                sender_id: currentUser.id,
                receiver_id: activeFriend.id,
                content: text
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

    window.addEventListener('silgu:page', function (e) {
        const name = e.detail && e.detail.name;
        if (name !== 'friends') return;

        if (!currentUser) {
            goPage('login');
            return;
        }

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