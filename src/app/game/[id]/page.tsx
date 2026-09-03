import GameClient from './GameClient';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <GameClient gameId={id} />;
}
