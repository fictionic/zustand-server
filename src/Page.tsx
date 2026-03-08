import MyStore from './MyStore';
import {StoreRoot} from './StoreRoot';
import Widget from './Widget';

function getElements() {
  const instance = MyStore.create({ userId: 1 });
  return (
    <StoreRoot instance={instance} def={MyStore}>
      <Widget />
    </StoreRoot>
  );
}
