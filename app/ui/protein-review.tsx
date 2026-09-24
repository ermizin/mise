type ProteinPerson = {
  id: string;
  name: string;
  actual: number;
  target: number;
  shortfall: number;
  partial: boolean;
};

export type ProteinReviewBatch = {
  id: string;
  period: string;
  people: ProteinPerson[];
};

export function ProteinReview({ batches, onEdit }: {
  batches: ProteinReviewBatch[];
  onEdit: () => void;
}) {
  const hasPartial = batches.some(batch => batch.people.some(person => person.partial));
  return (
    <section className="protein-review glass-card" aria-label="Белок в выбранном меню">
      <header className="protein-review-heading">
        <h2>Белок в меню</h2>
        <span>В день</span>
      </header>
      <p className="protein-review-caption">Из выбранных блюд / дневная цель</p>
      <div className="protein-review-batches">
        {batches.map(batch => (
          <div className="protein-review-batch" key={batch.id}>
            <h3>{batch.period}</h3>
            <ul>
              {batch.people.map(person => {
                const reached = person.shortfall === 0;
                const percent = person.target > 0
                  ? Math.min(100, Math.max(0, person.actual / person.target * 100))
                  : 0;
                return (
                  <li className="protein-review-person" key={person.id}>
                    <div className="protein-review-values">
                      <b className="protein-review-name">{person.name}</b>
                      <span className="protein-review-amount"><strong>{person.actual} г</strong><span> / {person.target} г</span></span>
                    </div>
                    <div className="protein-review-detail">
                    <div className="protein-review-track" aria-hidden="true">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    <p className={`protein-review-status${reached ? " is-reached" : ""}`}>
                      {reached ? "Цель достигнута" : person.partial
                        ? `Ещё ${person.shortfall} г вне плана`
                        : `До цели — ${person.shortfall} г`}
                    </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {hasPartial && <p className="protein-review-note">Учтены только выбранные блюда, а не весь дневной рацион.</p>}
      <button type="button" className="text-button protein-review-edit" onClick={onEdit}>Изменить блюда <span aria-hidden="true">→</span></button>
    </section>
  );
}
