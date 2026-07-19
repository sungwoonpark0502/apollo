// Apollo in Chrome, v1. Deliberately minimal in what it can see:
//
//   - NO host_permissions, NO content scripts, NO "scripting" permission.
//     The extension cannot read any page. What it forwards is only what
//     Chrome's own APIs hand it: the tab title/URL, and for the selection
//     item, the text the user themselves highlighted.
//   - It only composes a prefilled question and opens the Apollo web client;
//     the web client never auto-sends a ?q= prefill, so nothing is asked (and
//     no quota is spent) until the user presses Send there.
//
// The web origin is fixed at build time; change it here for a self-host.
const APOLLO_WEB = 'https://app.apolloassistant.app';

function openApollo(question) {
  const url = question ? `${APOLLO_WEB}/?q=${encodeURIComponent(question.slice(0, 3000))}` : APOLLO_WEB;
  chrome.tabs.create({ url });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'apollo-page',
    title: 'Ask Apollo about this page',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'apollo-selection',
    title: 'Ask Apollo about this selection',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'apollo-page' && tab) {
    openApollo(`About this page: ${tab.title ?? ''} (${tab.url ?? ''})`);
  } else if (info.menuItemId === 'apollo-selection') {
    openApollo(`"${info.selectionText ?? ''}" — what does this mean?`);
  }
});

// Toolbar button: just open Apollo.
chrome.action.onClicked.addListener(() => openApollo(null));
