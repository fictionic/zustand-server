import {defineZustandIsoStore} from "../adapters/zustand";

interface MyOpts {
  userId: number;
}
interface MyState {
  name: string;
  setName: (name: string) => void;
}
export default defineZustandIsoStore<MyOpts, MyState>(
  ({ userId }, waitFor) => (
    (set, get) => ({
      ...waitFor('name', new Promise<string>((resolve) => {
        // imagine this depended on userId
        setTimeout(() => resolve("bob"), 100);
      }), ''),
      setName: (name: string) => {
        set({
          name,
        });
      },
    })
  )
);
