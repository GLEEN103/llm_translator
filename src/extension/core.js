(() => {
  if (globalThis.TranslatorCore) return;
  const limits = Object.freeze({ segmentChars: 2400, requestChars: 12000, segments: 64, pageChars: 60_000, pageSegments: 500 });
  function splitText(text, max = limits.segmentChars) {
    if (!Number.isInteger(max) || max < 2) throw new Error('INVALID_SPLIT_SIZE');
    const result = [];
    let rest = text;
    while (rest.length > max) {
      let end = max;
      const boundary = Math.max(rest.lastIndexOf('\n', max - 1), rest.lastIndexOf(' ', max - 1));
      if (boundary > max / 2) end = boundary + 1;
      if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
      result.push(rest.slice(0, end)); rest = rest.slice(end);
    }
    if (rest) result.push(rest);
    return result;
  }
  function batches(segments) {
    const result = []; let batch = [], chars = 0;
    for (const segment of segments) {
      if (!segment.text.trim() || segment.text.length > limits.segmentChars) throw new Error('INVALID_SEGMENT');
      if (batch.length >= limits.segments || chars + segment.text.length > limits.requestChars) {
        result.push(batch); batch = []; chars = 0;
      }
      batch.push(segment); chars += segment.text.length;
    }
    if (batch.length) result.push(batch);
    return result;
  }
  function validResult(result, jobId, segments) {
    if (result?.jobId !== jobId || !Array.isArray(result.translations) || result.translations.length !== segments.length) return false;
    const ids = new Set(segments.map(segment => segment.id));
    let chars = 0;
    return result.translations.every(item => {
      if (!item || !ids.delete(item.id) || typeof item.text !== 'string' || !item.text.trim()) return false;
      chars += item.text.length; return chars <= 48_000;
    }) && ids.size === 0;
  }
  const messages = {
    INVALID_VIDEO_STYLE: '자막 표시 설정 값이 올바르지 않습니다. 기본값으로 복원한 뒤 다시 조절하세요.',
    CAPTIONS_BRIDGE_FAILED: '자막 수집 연결이 일시적으로 응답하지 않았습니다. ON 상태에서는 자동 재시도합니다. 반복되면 번역 패널을 닫고 다시 여세요. (CAPTIONS_BRIDGE_FAILED)',
    CAPTIONS_PLAYER_UNAVAILABLE: 'YouTube 플레이어 자막 기능이 아직 준비되지 않았습니다. 잠시 후 재시도하거나 번역 패널을 다시 여세요. (CAPTIONS_PLAYER_UNAVAILABLE)',
    CAPTIONS_PLAYER_TIMEOUT: 'YouTube 플레이어에서 선택한 언어의 자막 응답을 받지 못했습니다. YouTube 자막 설정에서 같은 원문 언어를 선택한 뒤 재시도하세요. (CAPTIONS_PLAYER_TIMEOUT)',
    UNSUPPORTED_VIDEO: 'YouTube 시청 페이지(www.youtube.com/watch) 또는 Shorts에서 실행하세요. 임베드는 지원하지 않습니다.',
    VIDEO_CHANGED: '영상이 바뀌었습니다. 현재 영상에서 확장 버튼으로 자막 번역을 다시 여세요.',
    VIDEO_AD: '광고가 끝난 뒤 자막 목록을 새로고침하세요.',
    VIDEO_LIVE: '실시간 방송 자막은 아직 지원하지 않습니다. 녹화 영상에서 실행하세요.',
    CAPTIONS_EMPTY: '제공되는 자막이 없습니다. YouTube에서 자막·자동자막 사용 가능 여부를 확인하세요.',
    CAPTIONS_UNAVAILABLE: 'YouTube 자막을 아직 불러오지 못했습니다. ON 상태에서는 자동 재시도합니다. 반복되면 자막 제공 여부를 확인하거나 번역 패널을 다시 여세요.',
    CAPTIONS_INVALID: 'YouTube 자막 형식이 맞지 않아 적용하지 않았습니다. 자막 목록을 새로고침하세요.',
    CAPTIONS_TOO_LARGE: '자막이 한도를 초과했습니다. 최대 5,000개 이벤트·100,000자·2 MiB까지 지원합니다.',
    UNSUPPORTED_IMAGE: '일반 웹페이지의 이미지에서 실행하세요. 프레임·편집 영역·배경 이미지는 아직 지원하지 않습니다.',
    IMAGE_NOT_FOUND: '클릭한 이미지를 확정하지 못했습니다. 로드된 이미지를 다시 우클릭하고 이미지 번역을 누르세요.',
    IMAGE_CHANGED: '이미지가 변경되었습니다. 다시 우클릭해 번역하세요.',
    INVALID_IMAGE: '지원되는 PNG/JPEG 이미지 데이터를 읽지 못했습니다. 이미지를 다시 선택하세요.',
    IMAGE_UNREADABLE: '이미지 픽셀을 읽지 못했습니다. 로드가 끝난 뒤 다시 실행하세요.',
    IMAGE_TOO_LARGE: '이미지 전송 한도를 초과했습니다. 최대 2048px·4 MiB로 처리할 수 있는 이미지를 선택하세요.',
    IMAGE_NOT_VISIBLE: '이 이미지는 화면 캡처가 필요합니다. 전체 이미지가 화면 안에 보이도록 스크롤·축소하고 가리는 창을 닫은 뒤 재시도하세요. 변형·잘림 이미지는 지원하지 않습니다.',
    IMAGE_CAPTURE_FAILED: '이미지 영역을 캡처하지 못했습니다. 해당 탭을 활성화한 뒤 다시 실행하세요.',
    IMAGE_CAPTURE_WAIT: '캡처가 진행 중이거나 너무 빠릅니다. 잠시 뒤 다시 시도하세요.',
    IMAGE_ACTION_EXPIRED: '이미지 작업이 종료되었거나 확장이 다시 시작되었습니다. 이미지를 다시 우클릭하세요.',
    IMAGE_SESSION_BUDGET: '이번 브라우저 세션의 이미지 요청 50회 한도에 도달했습니다. 재시도도 포함됩니다.',
    IMAGE_MODEL_UNSUPPORTED: '선택한 모델이 이미지 입력·구조화 응답을 지원하지 않거나 요청을 거절했습니다. API 설정에서 이미지 입력을 지원하는 모델을 활성화하세요.',
    UNAUTHORIZED: '허용되지 않은 요청입니다. 확장 버튼에서 다시 시작하세요.',
    UNSUPPORTED_SELECTION: '입력란·편집 영역·프레임은 선택 번역에서 제외합니다. 일반 페이지 본문에서 선택하고 우클릭하세요.',
    UNSUPPORTED_PAGE: '일반 웹페이지에서 실행하세요. Chrome 내부 페이지와 PDF는 지원하지 않습니다.',
    PAGE_CHANGED: '페이지가 이동했습니다. 텍스트를 다시 선택하고 우클릭하세요.',
    CONTEXT_MENU_FAILED: '우클릭 메뉴를 등록하지 못했습니다. 확장 관리 화면에서 확장을 새로고침하세요.',
    NOT_CONFIGURED: '확장 설정에서 선택한 공급자의 API 키를 입력하고 목록에서 모델을 선택하세요.',
    INVALID_SETTINGS: 'API 키를 확인하고 불러온 목록에서 모델을 선택하세요.',
    CONSENT_REQUIRED: '확장 버튼이나 API 설정 화면에서 이번 버전의 원문 전송에 한 번 동의해 주세요.',
    MODEL_LIST_CHANGED: 'API 키 또는 모델 목록이 변경됐습니다. 목록을 다시 불러와 선택하세요.',
    MODEL_KEY_REQUIRED: '이 모델에 저장된 키가 없습니다. API 키를 직접 입력하고 목록을 조회한 뒤 저장하세요.',
    STORAGE_FAILED: '브라우저 저장소 처리에 실패했습니다. 설정은 저장 또는 삭제되지 않았을 수 있습니다. 다시 확인하세요.',
    USAGE_STORAGE_FAILED: '토큰 기록 저장소에 접근하지 못했습니다. 새 번역 요청을 중단했습니다. 브라우저 저장 공간을 확인하세요.',
    INVALID_MODEL_LIST: '공급자 모델 목록 응답을 읽을 수 없습니다. 다시 불러오세요.',
    NO_MODELS: '콘텐츠 생성을 지원하는 모델이 없습니다. API 키의 프로젝트와 권한을 확인하세요.',
    SETTINGS_CHANGED: 'API 설정이 변경됐습니다. 확장 버튼에서 새 번역을 시작하세요.',
    PROVIDER_AUTH: '선택한 공급자의 API 키의 권한 또는 유효성을 확인하세요.',
    OPENAI_REQUEST_TIMEOUT: 'OpenAI 응답 대기 시간이 초과됐습니다. 이미 보낸 요청이 처리 중일 수 있어 자동 반복을 중단했습니다. (OPENAI_REQUEST_TIMEOUT)',
    OPENAI_NETWORK: 'OpenAI 연결에 실패했습니다. 중복 요청을 방지하기 위해 자동 반복을 중단했습니다. (OPENAI_NETWORK)',
    OPENAI_UNAVAILABLE: 'OpenAI 서버에서 요청을 완료하지 못했습니다. 잠시 후 직접 다시 실행하세요. (OPENAI_UNAVAILABLE)',
    OPENAI_RATE_LIMIT: 'OpenAI 호출 한도에 도달했습니다. 잠시 후 직접 다시 실행하세요. (OPENAI_RATE_LIMIT)',
    OPENAI_INCOMPLETE: 'OpenAI 출력이 완료되지 않았습니다. 더 작은 번역 범위나 다른 모델로 다시 실행하세요. (OPENAI_INCOMPLETE)',
    OPENAI_REFUSAL: 'OpenAI 모델이 이 요청에 대한 응답을 거절했습니다. (OPENAI_REFUSAL)',
    OPENAI_RESPONSE_FORMAT: 'OpenAI 응답 형식이 맞지 않아 번역을 적용하지 않았습니다. (OPENAI_RESPONSE_FORMAT)',
    OPENAI_RESPONSE_JSON: 'OpenAI 번역 결과를 JSON으로 읽지 못했습니다. (OPENAI_RESPONSE_JSON)',
    OPENAI_TRANSPORT_START_TIMEOUT: 'OpenAI 번역 연결을 준비하는 시간이 초과됐습니다. (OPENAI_TRANSPORT_START_TIMEOUT)',
    OPENAI_TRANSPORT_START_FAILED: 'OpenAI 번역용 숨김 문서를 만들지 못했습니다. 확장을 새로고침하세요. (OPENAI_TRANSPORT_START_FAILED)',
    OPENAI_TRANSPORT_DISCONNECTED: 'OpenAI 번역 연결이 끊겨 자동 반복을 중단했습니다. (OPENAI_TRANSPORT_DISCONNECTED)',
    OPENAI_WORKER_START_FAILED: 'OpenAI 번역 작업을 시작하지 못했습니다. 확장을 새로고침하세요. (OPENAI_WORKER_START_FAILED)',
    PROVIDER_DISABLED: 'kie.ai는 응답 불안정으로 사용이 중지됐습니다. API 설정에서 Google AI Studio 또는 OpenAI 모델을 선택하세요. 기존 키와 통계는 보존됩니다.',
    PROVIDER_MODEL_OR_REQUEST: '공급자 모델 이름 또는 요청 지원 여부를 확인하세요.',
    PROVIDER_RATE_LIMIT: '공급자 호출 한도에 도달했습니다. 잠시 후 다시 실행하세요.',
    CLIENT_RATE_LIMIT: '확장의 호출 한도에 도달했습니다. 1분 뒤 다시 실행하세요.',
    SESSION_BUDGET: '이번 브라우저 세션의 문자 예산을 소진했습니다. 사용량을 확인하세요.',
    CLIENT_BUSY: '다른 번역 요청이 진행 중입니다. 잠시 후 다시 실행하세요.',
    PROVIDER_TIMEOUT: '공급자 응답 시간이 초과됐습니다. 재시도하면 중복 과금될 수 있습니다.',
    PROVIDER_NETWORK: '공급자 네트워크 연결에 실패했습니다.',
    PROVIDER_UNAVAILABLE: '공급자 서비스가 일시적으로 응답하지 않습니다.',
    PROVIDER_INCOMPLETE: '공급자가 번역을 완료하지 못했습니다. 입력 길이·모델·안전 제한을 확인하세요.',
    PROVIDER_IMAGE_UNSUPPORTED: '현재 kie.ai 연동은 텍스트·자막 번역을 지원합니다. 이미지 번역에는 Google AI Studio 모델을 활성화하세요.',
    MODEL_CATALOG_UNAVAILABLE: '공식 모델 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.',
    PROVIDER_BALANCE: '공급자 계정의 잔액 또는 사용 한도를 확인하세요.',
    INVALID_PROVIDER_RESPONSE: '번역 응답 형식이 맞지 않아 적용하지 않았습니다.',
    KIE_RESPONSE_JSON: 'kie.ai 서버 응답을 JSON으로 읽지 못했습니다. (KIE_RESPONSE_JSON)',
    KIE_HTTP_500: 'kie.ai 서버가 HTTP 500을 반환했습니다. 같은 요청의 자동 반복을 중단했습니다. (KIE_HTTP_500)',
    KIE_UPSTREAM_524: 'kie.ai에서 오류 524를 반환했습니다. 같은 요청의 자동 반복을 중단했습니다. (KIE_UPSTREAM_524)',
    KIE_REQUEST_TIMEOUT: '확장의 kie.ai 응답 대기 시간이 초과됐습니다. 이미 전송된 요청은 처리 중일 수 있어 자동 반복을 중단했습니다. (KIE_REQUEST_TIMEOUT)',
    KIE_TRANSPORT_START_TIMEOUT: '확장 내부 번역 연결을 준비하는 시간이 초과됐습니다. (KIE_TRANSPORT_START_TIMEOUT)',
    KIE_TRANSPORT_START_FAILED: '확장의 숨김 번역 문서를 만들지 못했습니다. 확장 업데이트와 권한을 확인하세요. (KIE_TRANSPORT_START_FAILED)',
    KIE_TRANSPORT_DISCONNECTED: '확장 내부 번역 연결이 끊겨 요청을 중단했습니다. (KIE_TRANSPORT_DISCONNECTED)',
    KIE_WORKER_START_FAILED: '확장의 번역 작업 스레드를 시작하지 못했습니다. 확장을 새로고침하세요. (KIE_WORKER_START_FAILED)',
    KIE_RESPONSE_ENVELOPE: 'kie.ai 응답에서 지원되는 완료 메시지 형식을 찾지 못했습니다. (KIE_RESPONSE_ENVELOPE)',
    KIE_TRANSLATION_EMPTY: '모델이 완료를 알렸지만 번역 텍스트가 비어 있습니다. (KIE_TRANSLATION_EMPTY)',
    KIE_TRANSLATION_TEXT: '모델이 JSON 대신 다른 형식의 텍스트를 반환했습니다. (KIE_TRANSLATION_TEXT)',
    KIE_TRANSLATION_JSON: '모델의 JSON·코드블록 출력에 문법 오류나 불필요한 텍스트가 있어 적용하지 않았습니다. (KIE_TRANSLATION_JSON)',
    KIE_TRANSLATION_SCHEMA: '모델의 번역 출력에 필수 항목이 없거나 내용·길이가 규격과 다릅니다. (KIE_TRANSLATION_SCHEMA)',
    KIE_TRANSLATION_IDS: '모델이 번역 구간을 누락·중복하거나 ID를 변경했습니다. (KIE_TRANSLATION_IDS)',
    PROVIDER_RESPONSE_TOO_LARGE: '번역 응답이 너무 커서 적용하지 않았습니다.',
    STALE_PAGE: '원문이 변경되어 결과를 적용하지 않았습니다. 대상을 다시 선택하세요.',
    CANCELLED: '번역을 취소했습니다. 이미 전송한 요청은 과금될 수 있습니다.',
    WORKER_INTERRUPTED: '확장 연결이 중단됐습니다. 확장 버튼에서 다시 시작하세요.',
    REQUEST_TOO_LARGE: '번역 대상이 한도를 초과했습니다. 더 작은 범위를 선택하세요.'
  };
  const scheduling = Object.freeze({ concurrent: 5, restMs: 5000 });
  const isFormatError = code => ['INVALID_PROVIDER_RESPONSE', 'OPENAI_RESPONSE_JSON', 'OPENAI_RESPONSE_FORMAT'].includes(code);
  async function formatRetry(task, active, { wait = waitActive, onError = () => {}, onWait = () => {} } = {}) {
    for (let attempt = 0; active(); attempt++) {
      try { return await localRetry(task, active, { wait, onWait }); }
      catch (error) {
        const code = error.code ?? error.message;
        if (!active() || !isFormatError(code)) throw error;
        onError({ code, attempt: attempt + 1, final: attempt >= 3 });
        if (attempt >= 3) throw error;
        await wait(scheduling.restMs, active);
      }
    }
    throw { code: 'CANCELLED', message: 'CANCELLED' };
  }
  function createErrorLog(parent) {
    const details = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('ol');
    summary.textContent = '번역 오류 로그'; details.hidden = true; details.append(summary, list); parent.append(details);
    list.style.cssText = 'max-height:180px;overflow:auto;overflow-wrap:anywhere;padding-left:22px;font:12px/1.5 system-ui';
    return record => {
      if (!isFormatError(record.code)) return;
      const item = document.createElement('li');
      item.textContent = `${new Date(record.time ?? Date.now()).toLocaleTimeString()} · ${record.code} · ${Number.isInteger(record.count) ? record.count : 1}구간 · ${record.final ? '3회 재시도 후 실패 · 해당 구간 제외' : `재시도 ${record.attempt}/3 예정`}`;
      list.append(item); while (list.children.length > 100) list.firstElementChild.remove();
      details.hidden = false; if (record.final) details.open = true;
    };
  }
  async function waitActive(ms, active, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    // Short cancellable slices; no background message is held open while waiting.
    while (ms > 0 && active()) { const slice = Math.min(ms, 250); await sleep(slice); ms -= slice; }
  }
  async function localRetry(task, active, { wait = waitActive, onWait = () => {} } = {}) {
    while (active()) {
      try { return await task(); }
      catch (error) {
        const code = error.code ?? error.message;
        if (!['CLIENT_BUSY', 'CLIENT_RATE_LIMIT'].includes(code)) throw error;
        onWait(code);
        await wait(code === 'CLIENT_RATE_LIMIT' ? 60000 : 1000, active);
      }
    }
    throw { code: 'CANCELLED', message: 'CANCELLED' };
  }
  async function parallelBatches(items, task, active, { wait = waitActive } = {}) {
    for (let i = 0; i < items.length && active(); i += scheduling.concurrent) {
      // Settle the whole wave before freeing its slots, including on failure.
      const outcomes = await Promise.allSettled(items.slice(i, i + scheduling.concurrent).map(item => active() ? task(item) : undefined));
      const failure = outcomes.find(outcome => outcome.status === 'rejected');
      if (failure) throw failure.reason;
      if (i + scheduling.concurrent < items.length && active()) await wait(scheduling.restMs, active);
    }
  }
  function requestMessage(runtime, message) {
    const wait = message.type === 'TRANSLATE' && message.body?.provider === 'openai' ? 200000 : message.type === 'TRANSLATE' && message.body?.provider === 'kie' ? 190000 : message.type === 'VIDEO_CAPTIONS' ? 40000 : 29000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject({ code: 'WORKER_INTERRUPTED' }), wait);
      Promise.resolve().then(() => runtime.sendMessage(message)).then(result => {
        clearTimeout(timer);
        if (result?.ok) resolve(result.data);
        else reject({ code: typeof result?.error === 'string' && /^[A-Z0-9_]+$/.test(result.error) ? result.error : 'WORKER_INTERRUPTED' });
      }, () => { clearTimeout(timer); reject({ code: 'WORKER_INTERRUPTED' }); });
    });
  }
  globalThis.TranslatorCore = Object.freeze({ limits, scheduling, isFormatError, formatRetry, createErrorLog, waitActive, localRetry, parallelBatches, splitText, batches, validResult, requestMessage,
    providerName: provider => provider === 'openai' ? 'OpenAI (GPT)' : provider === 'kie' ? 'kie.ai' : 'Google AI Studio',
    errorMessage: code => messages[code] ?? '요청을 처리하지 못했습니다. 연결과 설정을 확인하세요.' });
})();
