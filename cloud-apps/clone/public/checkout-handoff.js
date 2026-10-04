// Capture the server-verifiable reference before the SDK's automatic redirect.
window.CloneCheckout = {
  succeeded: function (data) {
    var sandbox = window.CloneMode && CloneMode.environment === 'sandbox';
    var ref = data && data.transactionId;
    if (typeof ref === 'string' && /^[A-Za-z0-9-]{3,100}$/.test(ref)) {
      try { sessionStorage.setItem(sandbox ? 'jm_sandbox_clone_transaction' : 'jm_clone_transaction', ref); } catch (e) {}
    }
    try { sessionStorage.removeItem(sandbox ? 'jm_sandbox_checkout' : 'jm_checkout'); } catch (e) {}
    location.href = '/clone/software.html' + (sandbox ? '?sandbox=1' : '');
  }
};
