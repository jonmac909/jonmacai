// Capture the server-verifiable reference before the SDK's automatic redirect.
window.CloneCheckout = {
  succeeded: function (data) {
    var ref = data && data.transactionId;
    if (typeof ref === 'string' && /^[A-Za-z0-9-]{3,100}$/.test(ref)) {
      try { sessionStorage.setItem('jm_clone_transaction', ref); } catch (e) {}
    }
    try { sessionStorage.removeItem('jm_checkout'); } catch (e) {}
    location.href = '/clone/software.html';
  }
};
