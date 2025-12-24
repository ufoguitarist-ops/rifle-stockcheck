const scanBtn = document.getElementById('scanBtn');
const modal = document.getElementById('scanModal');
const closeBtn = document.getElementById('scanClose');

scanBtn.onclick = startScan;
closeBtn.onclick = stopScan;

function startScan(){
  modal.showModal();
  Quagga.init({
    inputStream: {
      type: 'LiveStream',
      target: document.querySelector('#scanner'),
      constraints: { facingMode: 'environment' }
    },
    decoder: { readers: ['code_128_reader'] }
  }, err => {
    if (err) { alert(err); return; }
    Quagga.start();
  });

  Quagga.onDetected(data => {
    alert('Scanned: ' + data.codeResult.code);
    stopScan();
  });
}

function stopScan(){
  Quagga.stop();
  modal.close();
}
