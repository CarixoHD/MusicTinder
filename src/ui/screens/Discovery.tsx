import { useStore } from '../../store/store';
import { Button } from '../Button';

export default function Discovery() {
  const seedCount = useStore((state) => state.seeds.length);
  const setScreen = useStore((state) => state.setScreen);

  return (
    <section className="screen screen--empty" aria-labelledby="discovery-title">
      <h1 id="discovery-title" className="screen__title">
        Your deck is getting ready
      </h1>
      <p className="screen__body">
        {seedCount === 0
          ? 'Pick some seeds and cards will start dealing here.'
          : `${seedCount} seed${seedCount === 1 ? '' : 's'} saved. Cards, samples and swiping are on their way.`}
      </p>
      <div className="screen__actions">
        <Button variant="secondary" onClick={() => setScreen('setup')}>
          Change seeds
        </Button>
      </div>
    </section>
  );
}
