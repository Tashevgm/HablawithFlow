let currentConversationId = null;
let messageSubscription = null;
let conversationRefreshTimerId = 0;
let messageRefreshTimerId = 0;
let conversationDirectory = [];
let rosterLookup = new Map();
let studentDirectory = [];
let sidebarMode = "conversations";
let requestedConversationId = "";

function getPortalTeacherUser() {
  if (window.HWFTeacherPortal && typeof window.HWFTeacherPortal.getCurrentTeacherUser === "function") {
    return window.HWFTeacherPortal.getCurrentTeacherUser();
  }

  return null;
}

async function getPortalAccessToken() {
  if (window.HWFTeacherPortal && typeof window.HWFTeacherPortal.getTeacherAccessToken === "function") {
    return window.HWFTeacherPortal.getTeacherAccessToken();
  }

  if (!window.supabaseClient) {
    return "";
  }

  const {
    data: { session }
  } = await window.supabaseClient.auth.getSession();

  return session?.access_token || "";
}

function getPortalApiBaseUrl() {
  const configuredApiBase =
    window.HWF_APP_CONFIG && typeof window.HWF_APP_CONFIG.apiBase === "string"
      ? window.HWF_APP_CONFIG.apiBase.trim()
      : "";

  return configuredApiBase || window.location.origin;
}

function buildPortalApiUrl(url) {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) {
    return getPortalApiBaseUrl();
  }

  try {
    return new URL(rawUrl, getPortalApiBaseUrl()).toString();
  } catch {
    const base = getPortalApiBaseUrl().replace(/\/$/, "");
    const path = rawUrl.replace(/^\//, "");
    return `${base}/${path}`;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function buildStudentLookupEntry(student) {
  return {
    id: String(student?.id || "").trim(),
    email: normalizeEmail(student?.email || ""),
    name: String(student?.name || student?.full_name || "Student").trim() || "Student",
    level: String(student?.level || "").trim(),
    track: String(student?.track || "").trim()
  };
}

function looksLikeAuthUserId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function canStartStudentConversation(student) {
  return looksLikeAuthUserId(student?.id);
}

async function authorizedPortalFetch(url, options = {}) {
  const accessToken = await getPortalAccessToken();
  if (!accessToken) {
    throw new Error("Missing session token.");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);

  return fetch(buildPortalApiUrl(url), {
    ...options,
    headers
  });
}

async function loadStudentRosterContext() {
  const teacherPortal = window.HWFTeacherPortal;
  if (teacherPortal && typeof teacherPortal.refreshTeacherStudents === "function") {
    await teacherPortal.refreshTeacherStudents();
  }

  const roster = teacherPortal && typeof teacherPortal.getStudents === "function" ? teacherPortal.getStudents() : [];
  rosterLookup = new Map();
  studentDirectory = [];
  const seenStudents = new Set();

  roster.forEach((student) => {
    const entry = buildStudentLookupEntry(student);
    const entryKey = entry.id ? `id:${entry.id}` : entry.email ? `email:${entry.email}` : "";
    if (!entryKey || seenStudents.has(entryKey)) {
      return;
    }

    seenStudents.add(entryKey);
    studentDirectory.push(entry);

    if (entry.id) {
      rosterLookup.set(`id:${entry.id}`, entry);
    }
    if (entry.email) {
      rosterLookup.set(`email:${entry.email}`, entry);
    }
  });

  studentDirectory.sort((left, right) => left.name.localeCompare(right.name));
}

function setConversationStartFeedback(message, type) {
  const feedback = document.getElementById("conversation-start-feedback");
  if (!feedback) {
    return;
  }

  if (!String(message || "").trim()) {
    feedback.textContent = "";
    feedback.hidden = true;
    return;
  }

  feedback.textContent = String(message || "");
  feedback.className = `booking-feedback messages-sidebar-feedback ${type}`;
  feedback.hidden = false;
}

function resolveConversationPartner(conversation) {
  const teacherUser = getPortalTeacherUser();
  const studentId = String(conversation?.student_id || "").trim();
  const teacherId = String(conversation?.teacher_id || "").trim();
  const isTeacherView = teacherUser && teacherId === String(teacherUser.id || "").trim();
  const partnerKey = isTeacherView ? `id:${studentId}` : `id:${teacherId}`;
  const studentEntry = rosterLookup.get(`id:${studentId}`) || null;
  const fallback = rosterLookup.get(partnerKey) || studentEntry || null;

  return {
    id: fallback?.id || (isTeacherView ? studentId : teacherId),
    name: fallback?.name || conversation?.subject || "Conversation",
    subtitle:
      fallback?.track && fallback?.level
        ? `${fallback.track} • ${fallback.level}`
        : fallback?.track || fallback?.level || "Student conversation",
    avatar: (fallback?.name || conversation?.subject || "S").trim().charAt(0).toUpperCase() || "S"
  };
}


function createStudentDirectoryElement(student) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "conversation-item";
  button.dataset.studentId = String(student.id || "");

  const subtitle = student.track && student.level
    ? `${student.track} • ${student.level}`
    : student.track || student.level || student.email || "Student";

  button.innerHTML = `
    <div class="conversation-header">
      <div class="conversation-avatar">${escapeHtml((student.name || "S").charAt(0).toUpperCase() || "S")}</div>
      <div class="conversation-info">
        <h4>${escapeHtml(student.name || "Student")}</h4>
        <p class="conversation-preview">${escapeHtml(subtitle)}</p>
      </div>
      <span class="conversation-timestamp">Chat</span>
    </div>
  `;

  button.addEventListener("click", () => {
    void openConversationFromStudentDirectory(student.id, button);
  });

  return button;
}

function renderStudentDirectoryList(students) {
  const conversationsList = document.getElementById("conversations-list");
  if (!conversationsList) {
    return;
  }

  sidebarMode = "students";

  if (!Array.isArray(students) || !students.length) {
    conversationsList.innerHTML = '<div class="messages-sidebar-empty">No students available yet.</div>';
    return;
  }

  conversationsList.innerHTML = "";
  students.forEach((student) => {
    conversationsList.appendChild(createStudentDirectoryElement(student));
  });
}

function findConversationByStudentId(studentId, conversations = conversationDirectory) {
  const normalizedStudentId = String(studentId || "").trim();
  if (!normalizedStudentId || !Array.isArray(conversations)) {
    return null;
  }

  return (
    conversations.find((conversation) => String(conversation?.student_id || "").trim() === normalizedStudentId) || null
  );
}

async function resolveConversationByStudentId(studentId, refresh = false) {
  const existingConversation = findConversationByStudentId(studentId);
  if (existingConversation || !refresh) {
    return existingConversation;
  }

  await loadConversations();
  return findConversationByStudentId(studentId);
}

async function loadConversations() {
  try {
    await loadStudentRosterContext();
    const response = await authorizedPortalFetch("/api/messages/conversations");
    if (!response.ok) {
      throw new Error("Failed to load conversations");
    }

    const payload = await response.json();
    if (!payload.ok || !Array.isArray(payload.conversations)) {
      throw new Error(payload.message || "Invalid conversations payload");
    }

    conversationDirectory = payload.conversations;
    if (payload.conversations.length) {
      renderConversationList(payload.conversations);
    } else {
      renderStudentDirectoryList(studentDirectory.filter((student) => canStartStudentConversation(student)));
    }
  } catch (error) {
    conversationDirectory = [];
    renderStudentDirectoryList(studentDirectory.filter((student) => canStartStudentConversation(student)));
  }
}

function renderConversationList(conversations) {
  const conversationsList = document.getElementById("conversations-list");
  if (!conversationsList) {
    return;
  }

  sidebarMode = "conversations";

  if (!conversations.length) {
    renderStudentDirectoryList(studentDirectory.filter((student) => canStartStudentConversation(student)));
    return;
  }

  conversationsList.innerHTML = "";
  conversations.forEach((conversation) => {
    const element = createConversationElement(conversation);
    conversationsList.appendChild(element);
  });

  if (requestedConversationId) {
    const requestedConversation = conversations.find(
      (conversation) => String(conversation.id || "") === requestedConversationId
    );

    if (requestedConversation) {
      const requestedElement = conversationsList.querySelector(`[data-conversation-id="${requestedConversationId}"]`);
      requestedConversationId = "";
      void selectConversation(requestedConversation, requestedElement);
    }

    return;
  }

  if (!currentConversationId && conversations.length === 1) {
    const firstConversation = conversations[0];
    const firstElement = conversationsList.querySelector(
      `[data-conversation-id="${String(firstConversation.id || "")}"]`
    );
    void selectConversation(firstConversation, firstElement);
  }
}

function stopMessagePolling() {
  if (!messageRefreshTimerId) {
    return;
  }

  window.clearInterval(messageRefreshTimerId);
  messageRefreshTimerId = 0;
}

function startMessagePolling() {
  stopMessagePolling();
  messageRefreshTimerId = window.setInterval(() => {
    if (!currentConversationId) {
      return;
    }

    void loadMessages();
    void loadConversations();
  }, 5000);
}

function createConversationElement(conversation) {
  const partner = resolveConversationPartner(conversation);
  const div = document.createElement("button");
  div.type = "button";
  div.className = "conversation-item";
  div.dataset.conversationId = String(conversation.id || "");
  if (conversation.id === currentConversationId) {
    div.classList.add("active");
  }

  const lastMessage = conversation.last_message_at
    ? new Date(conversation.last_message_at).toLocaleString("en-GB", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "No messages";

  div.innerHTML = `
    <div class="conversation-header">
      <div class="conversation-avatar">${partner.avatar}</div>
      <div class="conversation-info">
        <h4>${escapeHtml(partner.name)}</h4>
        <p class="conversation-preview">${escapeHtml(partner.subtitle)}</p>
      </div>
      <span class="conversation-timestamp">${lastMessage}</span>
    </div>
  `;

  div.addEventListener("click", () => {
    selectConversation(conversation, div);
  });

  return div;
}

async function selectConversation(conversation, element) {
  currentConversationId = conversation.id;
  document.querySelectorAll(".conversation-item").forEach((item) => item.classList.remove("active"));
  if (element) {
    element.classList.add("active");
  } else {
    const conversationStudentId = String(conversation?.student_id || "").trim();
    const fallbackStudentItem = conversationStudentId
      ? document.querySelector(`.conversation-item[data-student-id="${conversationStudentId}"]`)
      : null;
    if (fallbackStudentItem) {
      fallbackStudentItem.classList.add("active");
    }
  }

  const chatEmpty = document.getElementById("chat-empty");
  const chatThread = document.getElementById("chat-thread");
  if (chatEmpty) {
    chatEmpty.hidden = true;
  }
  if (chatThread) {
    chatThread.hidden = false;
  }

  await loadMessages();
  subscribeToMessages();
  startMessagePolling();

  const messageInput = document.getElementById("message-input");
  if (messageInput) {
    try {
      messageInput.focus({ preventScroll: true });
    } catch {
      messageInput.focus();
    }
  }
}

async function startConversationByStudent(studentId) {
  const normalizedStudentId = String(studentId || "").trim();
  const student = studentDirectory.find((entry) => entry.id === normalizedStudentId) || null;
  if (!student || !canStartStudentConversation(student)) {
    setConversationStartFeedback("This student needs an active portal account before chat is available.", "error");
    return null;
  }

  const response = await authorizedPortalFetch("/api/messages/conversations/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      otherUserId: normalizedStudentId
    })
  });

  const payload = await response.json().catch(() => ({
    ok: false,
    error: `Failed to open chat (${response.status}).`
  }));

  if (!response.ok || payload?.ok !== true || !payload?.conversation?.id) {
    throw new Error(String(payload?.error || payload?.message || `Failed to open chat (${response.status}).`));
  }

  currentConversationId = String(payload.conversation.id || "").trim();
  return payload.conversation;
}

async function openConversationFromStudentDirectory(studentId, triggerElement) {
  const trigger = triggerElement || null;
  const originalDisabled = trigger ? trigger.disabled : false;

  if (trigger) {
    trigger.disabled = true;
  }

  setConversationStartFeedback("", "success");

  try {
    const existingConversation =
      (await resolveConversationByStudentId(studentId, false)) ||
      (await resolveConversationByStudentId(studentId, true));

    if (existingConversation) {
      const existingElement = document.querySelector(
        `[data-conversation-id="${String(existingConversation.id || "")}"]`
      );
      await selectConversation(existingConversation, existingElement || trigger);
      return;
    }

    const startedConversation = await startConversationByStudent(studentId);
    if (!startedConversation) {
      throw new Error("Could not open chat right now.");
    }

    await loadConversations();

    const refreshedConversation =
      findConversationByStudentId(studentId) ||
      conversationDirectory.find(
        (conversation) => String(conversation?.id || "").trim() === String(startedConversation.id || "").trim()
      ) ||
      null;

    const directConversation = refreshedConversation || {
      ...startedConversation,
      student_id: startedConversation.student_id || studentId
    };

    const activeElement = directConversation?.id
      ? document.querySelector(`[data-conversation-id="${String(directConversation.id || "")}"]`)
      : null;

    await selectConversation(directConversation, activeElement || trigger);
  } catch (error) {
    setConversationStartFeedback(error instanceof Error ? error.message : "Could not open chat right now.", "error");
  } finally {
    if (trigger) {
      trigger.disabled = originalDisabled;
    }
  }
}

async function loadMessages() {
  if (!currentConversationId) {
    return;
  }

  try {
    const response = await authorizedPortalFetch(`/api/messages/conversations/${currentConversationId}`);
    if (!response.ok) {
      throw new Error("Failed to load messages");
    }

    const payload = await response.json();
    if (!payload.ok) {
      throw new Error(payload.message || "Invalid messages payload");
    }

    const partner = resolveConversationPartner(payload.conversation);
    const chatUserName = document.getElementById("chat-user-name");
    const chatUserRole = document.getElementById("chat-user-role");
    const chatUserAvatar = document.getElementById("chat-user-avatar");
    if (chatUserName) {
      chatUserName.textContent = partner.name;
    }
    if (chatUserRole) {
      chatUserRole.textContent = partner.subtitle;
    }
    if (chatUserAvatar) {
      chatUserAvatar.textContent = partner.avatar;
    }

    const messagesContainer = document.getElementById("chat-messages");
    if (!messagesContainer) {
      return;
    }

    messagesContainer.innerHTML = "";
    if (!Array.isArray(payload.messages) || !payload.messages.length) {
      messagesContainer.innerHTML =
        '<div style="text-align: center; color: #7d6c61; padding: 40px; font-size: 0.9rem;">No messages yet. Start the conversation.</div>';
      return;
    }

    const teacherUser = getPortalTeacherUser();
    payload.messages.forEach((message) => {
      const messageElement = createMessageElement(message, teacherUser?.id || "");
      messagesContainer.appendChild(messageElement);

      const unreadByTeacher =
        String(message.sender_id || "") !== String(teacherUser?.id || "") &&
        !message.message_read_status?.some((status) => String(status.reader_id || "") === String(teacherUser?.id || ""));

      if (unreadByTeacher) {
        void markMessageAsRead(message.id);
      }
    });

    const scroll = document.getElementById("chat-messages-scroll");
    if (scroll) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  } catch (error) {
    const errorContainer = document.getElementById("message-error");
    if (errorContainer) {
      errorContainer.textContent = "Failed to load messages.";
      errorContainer.hidden = false;
    }
  }
}

function createMessageElement(message, currentUserId) {
  const element = document.createElement("div");
  const isOwn = String(message.sender_id || "") === String(currentUserId || "");
  const timestamp = new Date(message.created_at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  });

  element.className = `message ${isOwn ? "sent" : "received"}`;
  element.innerHTML = `
    <div class="message-content">${escapeHtml(message.body || "")}</div>
    <div class="message-time">${timestamp}</div>
  `;
  return element;
}

async function sendMessage() {
  if (!currentConversationId) {
    return;
  }

  const input = document.getElementById("message-input");
  const errorContainer = document.getElementById("message-error");
  if (!input) {
    return;
  }

  const body = input.value.trim();
  if (!body) {
    return;
  }

  if (errorContainer) {
    errorContainer.hidden = true;
  }

  try {
    const response = await authorizedPortalFetch("/api/messages/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        conversationId: currentConversationId,
        body
      })
    });

    if (!response.ok) {
      throw new Error("Failed to send message");
    }

    const payload = await response.json();
    if (!payload.ok) {
      throw new Error(payload.message || "Failed to send message");
    }

    input.value = "";
    input.style.height = "auto";
    await loadMessages();
    await loadConversations();
  } catch (error) {
    if (errorContainer) {
      errorContainer.textContent = "Failed to send message.";
      errorContainer.hidden = false;
    }
  }
}

async function markMessageAsRead(messageId) {
  try {
    await authorizedPortalFetch(`/api/messages/${messageId}/read`, {
      method: "POST"
    });
  } catch {}
}

function subscribeToMessages() {
  if (!currentConversationId || !window.supabaseClient) {
    return;
  }

  if (messageSubscription) {
    window.supabaseClient.removeChannel(messageSubscription);
    messageSubscription = null;
  }

  messageSubscription = window.supabaseClient
    .channel(`messages:${currentConversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${currentConversationId}`
      },
      () => {
        void loadMessages();
        void loadConversations();
      }
    )
    .subscribe();
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };

  return String(text || "").replace(/[&<>"']/g, (character) => map[character]);
}

function bindConversationSidebarList() {
  const conversationsList = document.getElementById("conversations-list");
  if (!conversationsList || conversationsList.dataset.bound === "1") {
    return;
  }

  const handleConversationActivation = (target) => {
    const item = target instanceof Element ? target.closest(".conversation-item") : null;
    if (!item) {
      return;
    }

    const conversationId = String(item.getAttribute("data-conversation-id") || "").trim();
    if (conversationId) {
      const conversation = conversationDirectory.find(
        (entry) => String(entry?.id || "").trim() === conversationId
      );
      if (conversation) {
        void selectConversation(conversation, item);
      }
      return;
    }

    const studentId = String(item.getAttribute("data-student-id") || "").trim();
    if (studentId) {
      void openConversationFromStudentDirectory(studentId, item);
    }
  };

  conversationsList.addEventListener("click", (event) => {
    handleConversationActivation(event.target);
  });

  conversationsList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleConversationActivation(event.target);
  });

  conversationsList.dataset.bound = "1";
}

function bindMessagesPage() {
  bindConversationSidebarList();

  const sendButton = document.getElementById("send-message-btn");
  if (sendButton) {
    sendButton.addEventListener("click", () => {
      void sendMessage();
    });
  }

  const input = document.getElementById("message-input");
  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void sendMessage();
      }
    });

    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    });
  }

  const searchInput = document.getElementById("conversations-search");
  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      const query = String(event.target.value || "").trim().toLowerCase();
      if (sidebarMode === "students") {
        const filteredStudents = query
          ? studentDirectory.filter((student) => {
              return `${student.name} ${student.track} ${student.level} ${student.email}`.toLowerCase().includes(query);
            })
          : studentDirectory.filter((student) => canStartStudentConversation(student));

        renderStudentDirectoryList(filteredStudents.filter((student) => canStartStudentConversation(student)));
        return;
      }

      const filtered = query
        ? conversationDirectory.filter((conversation) => {
            const partner = resolveConversationPartner(conversation);
            return `${partner.name} ${partner.subtitle}`.toLowerCase().includes(query);
          })
        : conversationDirectory;

      renderConversationList(filtered);
    });
  }
}

async function waitForTeacherSession() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const teacherUser = getPortalTeacherUser();
    if (teacherUser && teacherUser.id) {
      return teacherUser;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }

  if (!window.supabaseClient) {
    return null;
  }

  const {
    data: { user }
  } = await window.supabaseClient.auth.getUser();

  return user || null;
}

async function initMessagesPage() {
  const teacherUser = await waitForTeacherSession();
  if (!teacherUser) {
    window.location.href = "teacher-login.html";
    return;
  }

  requestedConversationId = String(new URLSearchParams(window.location.search).get("conversation") || "").trim();

  bindMessagesPage();
  await loadConversations();

  if (conversationRefreshTimerId) {
    window.clearInterval(conversationRefreshTimerId);
  }

  conversationRefreshTimerId = window.setInterval(() => {
    void loadConversations();
  }, 30000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void initMessagesPage();
  });
} else {
  void initMessagesPage();
}
