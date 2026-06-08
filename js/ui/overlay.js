const OVERLAY_INERT_MARKER = 'overlayInert';

function getActiveOverlay(body){
  if (body.dataset.newsDialogOpen === 'true'){
    return document.getElementById('news-dialog');
  }

  if (body.dataset.a11yPanelOpen === 'true'){
    return document.getElementById('a11y-panel');
  }

  return null;
}

export function syncSharedOverlayState(backdrop = document.getElementById('backdrop')){
  const body = document.body;
  if (!body) return;

  const activeOverlay = getActiveOverlay(body);
  const shouldLock = !!activeOverlay;

  body.classList.toggle('dialog-open', shouldLock);
  document.documentElement.classList.toggle('dialog-open', shouldLock);
  if (backdrop) backdrop.hidden = !shouldLock;

  Array.from(body.children).forEach((element) => {
    const shouldStayActive =
      !shouldLock ||
      element === activeOverlay ||
      element === backdrop ||
      element.id === 'a11y-live' ||
      element.tagName === 'SCRIPT';

    if (!shouldStayActive && !element.inert){
      element.inert = true;
      element.dataset[OVERLAY_INERT_MARKER] = 'true';
    }else if (shouldStayActive && element.dataset[OVERLAY_INERT_MARKER] === 'true'){
      element.inert = false;
      delete element.dataset[OVERLAY_INERT_MARKER];
    }
  });
}
