import MyStore from './MyStore';

const useClientMyStore = MyStore.createClientStore({ userId: 4 });

export default function Widget() {
  const name = MyStore.useStore((state) => state.name);
  const name2 = useClientMyStore((state) => state.name);
  return (
    <div>
      { name }
    </div>
  );
}



