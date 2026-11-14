# Layar Studio

Web app statis untuk merekam layar, menambahkan kamera sebagai overlay, dan mencampur suara mikrofon dengan audio media. Semua pemrosesan dan pembuatan file terjadi di browser.

## Deploy ke Netlify

1. Ekstrak ZIP. Upload isi hasil ekstrak ke root repository GitHub. Pastikan `index.html` dan `netlify.toml` ada di root.
2. Di Netlify, pilih opsi untuk mengimpor proyek dari Git lalu pilih repository dan branch.
3. Kosongkan Base directory dan Build command. Publish directory adalah `.` sesuai `netlify.toml`.
4. Deploy dan buka URL HTTPS situs di tab browser biasa. Alternatifnya, unggah folder hasil ekstrak lewat Netlify Drop.

Aplikasi ini berbasis HTML, CSS, dan JavaScript. Tidak perlu npm, API key, database, atau backend. Untuk mencoba di laptop sebelum deploy, buka terminal di folder aplikasi, jalankan `python -m http.server 8080`, lalu buka `http://localhost:8080`.

## Rekam langsung

1. Buka lewat Chrome atau Edge desktop untuk dukungan audio tab. Pilih **Layar, jendela, atau tab**.
2. Atur overlay dan pilih kamera **Depan / webcam utama** atau **Belakang** jika perangkat memilikinya. Posisi dan ukuran overlay bisa diubah selama perekaman.
3. Nyalakan **Mikrofon**, **Audio media**, keduanya, atau matikan keduanya. Slider mengatur volume masing-masing.
4. Klik **Siapkan pratinjau**. Pilih sumber di dialog browser. Untuk suara media dalam tab, pilih tab yang memutar media dan aktifkan opsi **Bagikan audio tab**. Berbagi audio seluruh layar atau jendela bergantung pada browser, sistem operasi, dan sumber yang dipilih.
5. Periksa panel Audio. **Audio media tersambung** berarti browser mengirim track audio. Indikator level bergerak ketika ada suara yang masuk. Jika audio media belum diterima, tutup pratinjau lalu pilih ulang sumber yang mendukung berbagi audio.
6. Klik **Mulai rekam**. Gunakan **Jeda**, **Lanjutkan**, atau **Stop rekam**. Jika berbagi layar dihentikan dari kontrol browser, aplikasi akan menyelesaikan file dari data yang sudah direkam.
7. Putar hasil untuk memeriksa video dan suara, lalu klik **Unduh video**. Format WebM atau MP4 ditentukan dari format perekaman yang didukung browser.

## Smartphone dan tablet

- Chrome Android belum menawarkan perekaman layar langsung untuk web biasa. Bila opsi perekaman layar tidak tersedia, gunakan perekam layar bawaan perangkat lalu pilih **File video dari perangkat**.
- Dengan mode impor, pilih hasil rekam layar dan siapkan pratinjau. Saat menekan **Mulai rekam**, file diputar dari awal dan aplikasi menggabungkan gambar video dengan overlay kamera serta mikrofon yang sedang digunakan. Audio media berasal dari audio yang sudah ada di file. Pemrosesan berlangsung mengikuti durasi pemutaran dan berhenti otomatis ketika file selesai. Gunakan pratinjau hasil untuk mendengar audio file.
- Dukungan berbagi layar Safari bergantung pada versi perangkat. Aplikasi mengecek apakah fungsi berbagi layar tersedia. Mode **Kamera saja** dapat dipakai jika kamera dan perekaman browser didukung.

## Catatan perekaman

- Resolusi 720p atau 1080p adalah batas atas. Aplikasi mempertahankan rasio sumber dan tidak memperbesar video beresolusi lebih rendah.
- Biarkan halaman perekam terbuka. Browser dapat memperlambat komposisi video jika tab berjalan di latar belakang, perangkat terkunci, atau penghemat daya aktif.
- Selama merekam, data video tersimpan sementara di memori browser. Untuk rekaman panjang, gunakan 720p atau pecah menjadi beberapa sesi. Unduh hasil sebelum menutup atau memuat ulang halaman.
