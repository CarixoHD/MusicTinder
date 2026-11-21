import { useStore } from '../../store/store';
import { Button } from '../Button';

export default function Liked() {
  const setScreen = useStore((state) => state.setScreen);

  return (
    <section className="screen screen--empty" aria-labelledby="liked-title">
      <h1 id="liked-title" className="screen__title">
        Nothing saved yet
      </h1>
      <p className="screen__body">Swipe a few cards and your finds collect here.</p>
      <div className="screen__actions">
        <Button variant="secondary" onClick={() => setScreen('discovery')}>
          Go to the deck
        </Button>
      </div>
    </section>
  );
}
