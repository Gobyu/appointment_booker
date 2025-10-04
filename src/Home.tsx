import massage1 from "./assets/massage1.png";

const Home = () => {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="relative w-full rounded-lg overflow-hidden">
        <img
          src={massage1}
          alt="Massage"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white/80 via-white/60 to-transparent" />
        <div className="absolute top-6 left-6 text-zinc-900">
          <h2 className="text-2xl font-bold">Relaxing Massage</h2>
          <p className="text-sm">Feel the stress melt away.</p>
        </div>
      </div>
    </div>
  );
};

export default Home;
