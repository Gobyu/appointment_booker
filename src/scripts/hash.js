import bcrypt from 'bcryptjs';

const run = async () => {
  const hash = await bcrypt.hash('admin', 12);
  console.log(hash);
};

run();
