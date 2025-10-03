import bcrypt from 'bcryptjs';

const plain = 'admin';
const stored = '$2b$12$GHvscpxb3d/GfI.9jdFiyuLiq/3hBXlr5tgixFRuOn7BIrmW5QGda';

bcrypt.compare(plain, stored).then(ok => {
  console.log('Match?', ok);
});
