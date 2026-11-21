import { StrictMode, useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { ArrowDown, ArrowLeft, ArrowUpRight, Check, ChevronLeft, ChevronRight, LoaderCircle, LockKeyhole, LogOut, MapPin, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import './style.css'

type ProductVariant = {
  id: string
  color: string
  image_url: string
}

type Product = {
  id: string
  name: string
  image_url: string
  price: number | null
  category: 'priced' | 'unpriced'
  created_at: string
  description: string
  details: string
  variants: ProductVariant[]
  default_variant_id: string | null
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const supabase: SupabaseClient | null = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null
const currency = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })

function App() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [isAdmin, setIsAdmin] = useState(location.pathname.startsWith('/admin'))
  const [selected, setSelected] = useState<Product | null>(null)
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let active = true
    const loadProducts = async () => {
      const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false })
      if (!active) return
      if (error) setLoadError(error.message)
      else setProducts(data as Product[])
      setLoading(false)
    }
    void loadProducts()
    const channel = supabase.channel('public-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => void loadProducts())
      .subscribe()
    const { data: auth } = supabase.auth.onAuthStateChange((_event, current) => setSession(current))
    void supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session) })
    return () => {
      active = false
      void supabase.removeChannel(channel)
      auth.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const handlePop = () => setIsAdmin(location.pathname.startsWith('/admin'))
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  const goAdmin = (open: boolean) => {
    const path = open ? '/admin' : '/'
    history.pushState({}, '', path)
    setIsAdmin(open)
  }

  const priced = products.filter((product) => product.price != null && product.category !== 'unpriced')
  const unpriced = products.filter((product) => product.price == null || product.category === 'unpriced')

  const saveProduct = async (form: FormData): Promise<boolean> => {
    if (!supabase || !session) return false
    setSaving(true)
    setNotice('')
    try {
      const name = String(form.get('name') ?? '').trim()
      const rawPrice = String(form.get('price') ?? '').trim()
      const requestedCategory = String(form.get('category'))
      const category = !rawPrice || requestedCategory === 'unpriced' ? 'unpriced' : 'priced'
      const price = category === 'priced' ? Number(rawPrice) : null
      const defaultVariantId = String(form.get('defaultVariant') ?? '')
      const file = form.get('image')
      const uploadImage = async (image: File) => {
        const extension = image.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
        const imagePath = `${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await supabase.storage.from('product-images').upload(imagePath, image, { upsert: false })
        if (uploadError) throw uploadError
        return supabase.storage.from('product-images').getPublicUrl(imagePath).data.publicUrl
      }
      let imageUrl = editing?.image_url ?? ''
      if (!defaultVariantId && file instanceof File && file.size > 0) imageUrl = await uploadImage(file)

      const variantIds = form.getAll('variantId').map(String)
      const variants: ProductVariant[] = []
      for (const id of variantIds) {
        const color = String(form.get(`variantColor-${id}`) ?? '').trim()
        const previous = editing?.variants?.find((variant) => variant.id === id)
        const variantFile = form.get(`variantImage-${id}`)
        let variantImage = previous?.image_url ?? ''
        if (variantFile instanceof File && variantFile.size > 0) variantImage = await uploadImage(variantFile)
        if (!color || !variantImage) throw new Error('Chaque couleur doit avoir un nom et une photo.')
        variants.push({ id, color, image_url: variantImage })
      }
      const defaultVariant = variants.find((variant) => variant.id === defaultVariantId)
      if (defaultVariant) imageUrl = defaultVariant.image_url
      if (!name || !imageUrl || (rawPrice && (!Number.isFinite(price) || (price ?? -1) < 0))) {
        throw new Error('Ajoutez un nom, une photo (ou une photo par couleur) et vérifiez le prix.')
      }
      const product = {
        name,
        image_url: imageUrl,
        price,
        category,
        description: String(form.get('description') ?? '').trim(),
        details: String(form.get('details') ?? '').trim(),
        variants,
        default_variant_id: defaultVariant?.id ?? null,
      }
      const result = editing
        ? await supabase.from('products').update(product).eq('id', editing.id)
        : await supabase.from('products').insert(product)
      if (result.error) throw result.error
      let saveNotice = editing ? 'Produit modifié avec succès.' : 'Produit ajouté avec succès.'
      if (editing) {
        const retainedImages = new Set([imageUrl, ...variants.map((variant) => variant.image_url)])
        const removedImages = [editing.image_url, ...(editing.variants ?? []).map((variant) => variant.image_url)]
          .filter((url, index, urls) => url && !retainedImages.has(url) && urls.indexOf(url) === index)
        const removedPaths = removedImages.map((url) => url.split('/product-images/')[1]).filter((path): path is string => !!path)
        if (removedPaths.length) {
          const { error: storageError } = await supabase.storage.from('product-images').remove(removedPaths.map(decodeURIComponent))
          if (storageError) saveNotice += ` Attention : certaines anciennes images n’ont pas pu être supprimées (${storageError.message}).`
        }
      }
      setEditing(null)
      setNotice(saveNotice)
      return true
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Une erreur est survenue. Réessayez.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const deleteProduct = async (product: Product) => {
    if (!supabase || !confirm(`Supprimer « ${product.name} » ?`)) return
    const { error } = await supabase.from('products').delete().eq('id', product.id)
    if (error) setNotice(error.message)
    else {
      const imagePaths = [product.image_url, ...(product.variants ?? []).map((variant) => variant.image_url)]
        .map((url) => url.split('/product-images/')[1])
        .filter((path): path is string => !!path)
      if (imagePaths.length) {
        const { error: storageError } = await supabase.storage.from('product-images').remove([...new Set(imagePaths)].map(decodeURIComponent))
        if (storageError) setNotice(`Produit supprimé, mais l’image n’a pas pu être supprimée : ${storageError.message}`)
      }
    }
  }

  if (isAdmin) {
    return <AdminPanel configured={!!supabase} session={session} products={products} onBack={() => goAdmin(false)}
      onSignOut={async () => { if (supabase) await supabase.auth.signOut() }} onSave={saveProduct}
      onEdit={setEditing} onDelete={deleteProduct} editing={editing} onCancelEdit={() => setEditing(null)}
      saving={saving} notice={notice} />
  }

  return (
    <main className="page-shell">
      <div className="star-field" aria-hidden="true">{Array.from({ length: 30 }, (_, index) =>
        <i key={index} style={{ '--x': `${(index * 67 + 13) % 100}%`, '--y': `${(index * 43 + 7) % 100}%`, '--delay': `${(index % 9) * -0.8}s`, '--size': `${index % 4 === 0 ? 5 : index % 3 === 0 ? 4 : 3}px` } as CSSProperties} />)}
        <i className="shooting-star shooting-star-one" /><i className="shooting-star shooting-star-two" /><i className="shooting-star shooting-star-three" /><i className="shooting-star shooting-star-four" /><i className="shooting-star shooting-star-five" /><i className="shooting-star shooting-star-six" />
      </div>
      <header className="topline">
        <a className="brand" href="/" aria-label="Starphone Paris, accueil">Starphone<span>®</span></a>
        <div className="topline-note"><span className="status-dot" /> PARIS · EST. 1999</div>
        <a className="instagram-link" href="https://www.instagram.com/starphone_paris/" target="_blank" rel="noreferrer" aria-label="Instagram Starphone Paris"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".7" fill="currentColor" /></svg><span>INSTAGRAM</span><ArrowUpRight size={13} /></a>
      </header>

      <section className="intro">
        <p className="eyebrow"><Sparkles size={13} /> THE ART OF THE EXTRAORDINARY</p>
        <h1>Le luxe <em>d’être unique.</em></h1>
        <p className="intro-copy">Depuis 25 ans, Starphone Paris cultive l’art de l’inattendu.<br className="desktop-break" /> Technologie, création et pièces de caractère.</p>
        <a className="discover-link" href="#collection">DÉCOUVRIR LA COLLECTION <ArrowDown size={14} /></a>
        <div className="intro-index">48°52′ N<br />02°18′ E</div>
      </section>

      <section className="collection" id="collection" aria-label="Collection Starphone Paris">
        <CollectionColumn title="À découvrir" subtitle="LA SÉLECTION" label="01" products={priced} loading={loading} error={loadError} priced onSelect={(product) => { setSelected(product); setSelectedVariantId(product.default_variant_id ?? product.variants?.[0]?.id ?? '') }} />
        <CollectionColumn title="Pièces d’exception" subtitle="SUR DEMANDE" label="02" products={unpriced} loading={loading} error={loadError} onSelect={(product) => { setSelected(product); setSelectedVariantId(product.default_variant_id ?? product.variants?.[0]?.id ?? '') }} />
      </section>

      <footer className="footer">
        <div className="footer-brand"><span className="brand footer-logo">Starphone<span>®</span></span><span className="footer-tagline">Le luxe d’être unique.</span><span className="footer-since">DEPUIS 1999</span></div>
        <div className="footer-address"><MapPin size={14} /><span>12 avenue Franklin D. Roosevelt<br />75008 Paris · Saint-Philippe-du-Roule</span></div>
        <div className="footer-hours"><span>LUN — SAM</span><span>9H30 — 19H30</span><a href="tel:+33153760500">+33 (0)1 53 76 05 00</a></div>
        <div className="footer-bottom"><span>© STARPHONE PARIS · NEW TECHNOLOGY EUROPE</span><button className="admin-entry" onClick={() => goAdmin(true)} aria-label="Administration"><LockKeyhole size={12} /> ADMIN</button><a href="https://www.instagram.com/starphone_paris/" target="_blank" rel="noreferrer">INSTAGRAM <ArrowUpRight size={11} /></a><a href="https://www.tiktok.com/@starphone.paris" target="_blank" rel="noreferrer" aria-label="TikTok Starphone Paris">TIKTOK <ArrowUpRight size={11} /></a></div>
      </footer>

      {selected && <div className="lightbox" role="dialog" aria-modal="true" aria-label={selected.name} onClick={() => setSelected(null)} onKeyDown={(event) => { if (event.key === 'Escape') setSelected(null) }}>
        <button className="lightbox-close" onClick={() => setSelected(null)} aria-label="Fermer"><X /></button>
        <button className="lightbox-arrow previous" aria-label="Produit précédent" onClick={(event) => { event.stopPropagation(); const list = selected.price !== null ? priced : unpriced; const index = list.findIndex((product) => product.id === selected.id); const nextProduct = list[(index - 1 + list.length) % list.length] ?? selected; setSelected(nextProduct); setSelectedVariantId(nextProduct.default_variant_id ?? nextProduct.variants?.[0]?.id ?? '') }}><ChevronLeft /></button>
        <ProductDetails product={selected} selectedVariantId={selectedVariantId} onVariantChange={setSelectedVariantId} />
        <button className="lightbox-arrow next" aria-label="Produit suivant" onClick={(event) => { event.stopPropagation(); const list = selected.price !== null ? priced : unpriced; const index = list.findIndex((product) => product.id === selected.id); const nextProduct = list[(index + 1) % list.length] ?? selected; setSelected(nextProduct); setSelectedVariantId(nextProduct.default_variant_id ?? nextProduct.variants?.[0]?.id ?? '') }}><ChevronRight /></button>
      </div>}
    </main>
  )
}

function CollectionColumn({ title, subtitle, label, products, loading, error, priced = false, onSelect }: {
  title: string; subtitle: string; label: string; products: Product[]; loading: boolean; error: string; priced?: boolean
  onSelect: (product: Product) => void
}) {
  return <section className={`collection-column ${priced ? 'priced-column' : 'request-column'}`}>
    <header className="column-heading"><div><p className="eyebrow">{subtitle}</p><h2>{title}</h2></div><span className="column-index">{label} / 02</span></header>
    {!supabase ? <div className="empty-state"><Sparkles size={18} /><p>La collection se dévoile bientôt.</p><span>Connectez Supabase pour afficher les pièces disponibles.</span></div>
      : error ? <div className="empty-state"><p>Impossible de charger la collection.</p><span>{error}</span></div>
      : loading ? <div className="empty-state"><LoaderCircle className="spin" size={20} /><span>Chargement de la collection…</span></div>
      : products.length === 0 ? <div className="empty-state"><Sparkles size={18} /><p>Une collection en mouvement.</p><span>Les prochaines pièces seront dévoilées ici.</span></div>
      : <div className="product-grid">{products.map((product) => <button className="product-card" key={product.id} onClick={() => onSelect(product)} aria-label={`Voir ${product.name}`}>
        <span className="product-image"><img src={product.variants?.find((variant) => variant.id === product.default_variant_id)?.image_url ?? product.image_url} alt="" loading="lazy" /><span className="image-open"><ArrowUpRight size={16} /></span></span>
        <span className="product-info"><span>{product.name}</span>{priced && product.price != null && <span className="product-price">{currency.format(product.price)}</span>}</span>
      </button>)}</div>}
    <span className="column-decor" />
  </section>
}

function AdminPanel({ configured, session, products, onBack, onSignOut, onSave, onEdit, onDelete, editing, onCancelEdit, saving, notice }: {
  configured: boolean; session: Session | null; products: Product[]; onBack: () => void; onSignOut: () => void
  onSave: (form: FormData) => Promise<boolean>; onEdit: (product: Product) => void; onDelete: (product: Product) => void
  editing: Product | null; onCancelEdit: () => void; saving: boolean; notice: string
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [productPage, setProductPage] = useState(0)
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [defaultVariantId, setDefaultVariantId] = useState('')
  const [imageName, setImageName] = useState('')
  const [variantFileNames, setVariantFileNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const currentVariants = editing?.variants ?? []
    setVariants(currentVariants)
    setDefaultVariantId(editing?.default_variant_id ?? currentVariants[0]?.id ?? '')
    setImageName('')
    setVariantFileNames({})
  }, [editing])

  const addVariant = () => {
    const variant = { id: crypto.randomUUID(), color: '', image_url: '' }
    setVariants((current) => [...current, variant])
    if (!defaultVariantId) setDefaultVariantId(variant.id)
  }
  const removeVariant = (id: string) => {
    setVariants((current) => current.filter((variant) => variant.id !== id))
    if (defaultVariantId === id) setDefaultVariantId(variants.find((variant) => variant.id !== id)?.id ?? '')
  }
  const matchingProducts = products.filter((product) => {
    const query = productSearch.trim().toLocaleLowerCase('fr')
    return !query || [product.name, product.description, product.details, ...(product.variants ?? []).map((variant) => variant.color)]
      .some((value) => value?.toLocaleLowerCase('fr').includes(query))
  })
  const pageCount = Math.max(1, Math.ceil(matchingProducts.length / 10))
  const currentPage = Math.min(productPage, pageCount - 1)
  const pagedProducts = matchingProducts.slice(currentPage * 10, currentPage * 10 + 10)

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!supabase) return
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) setError('Identifiants incorrects ou compte non autorisé.')
  }
  const submitProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const saved = await onSave(new FormData(form))
    if (saved && !editing) {
      form.reset()
      setImageName('')
      setVariants([])
      setDefaultVariantId('')
      setVariantFileNames({})
    }
  }
  return <main className="admin-page"><div className="admin-stars" aria-hidden="true">✦　 ·　 ✧　　 ·　 ✦　　 ·　　　 ✧　 ·</div>
    <header className="admin-top"><button className="brand" onClick={onBack}>Starphone<span>®</span></button><button className="back-link" onClick={onBack}><ArrowLeft size={15} /> RETOUR AU SITE</button></header>
    {!configured ? <section className="admin-login"><LockKeyhole size={24} /><p className="eyebrow">ESPACE PRIVÉ</p><h1>Configuration<br /><em>Supabase requise.</em></h1><p>Ajoutez l’URL de votre projet et sa clé publique dans le fichier <code>.env.local</code>, puis configurez la base de données avec <code>supabase/schema.sql</code>.</p></section>
    : !session ? <form className="admin-login" onSubmit={(event) => void login(event)}><LockKeyhole size={24} /><p className="eyebrow">ESPACE PRIVÉ · STARPHONE PARIS</p><h1>Bon retour<br /><em>dans les coulisses.</em></h1><label>Adresse e-mail<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">SE CONNECTER <ArrowUpRight size={15} /></button><span className="login-note">Accès réservé à l’administration.</span></form>
    : <section className="dashboard"><div className="dashboard-title"><div><p className="eyebrow">GESTION DE LA COLLECTION</p><h1>Les coulisses<span>.</span></h1><p>{products.length} pièce{products.length === 1 ? '' : 's'} dans la collection</p></div><button className="signout" onClick={() => void onSignOut()}><LogOut size={15} /> DÉCONNEXION</button></div>
      <button className="add-button" onClick={() => { onCancelEdit(); setFormOpen(!formOpen) }}><Plus size={19} /> AJOUTER UN PRODUIT</button>
      {(formOpen || editing) && <form className="product-form" onSubmit={(event) => void submitProduct(event)}><div className="form-title"><h2>{editing ? 'Modifier le produit' : 'Nouvelle pièce'}</h2><button type="button" className="icon-button" onClick={() => { onCancelEdit(); setFormOpen(false) }} aria-label="Fermer"><X size={17} /></button></div>
        <label className="upload-field">{imageName || (editing ? 'CHANGER L’IMAGE PRINCIPALE' : 'IMPORTER L’IMAGE PRINCIPALE')}<input type="file" name="image" accept="image/*" onChange={(event) => setImageName(event.target.files?.[0]?.name ?? '')} />{editing && !imageName && <small>Laisser vide pour conserver l’image actuelle. Avec des couleurs, choisissez la photo par défaut plus bas.</small>}</label>
        <label>Nom du produit<input name="name" defaultValue={editing?.name ?? ''} required placeholder="Ex. Casquette Starphone" /></label>
        <div className="form-row"><label>Prix en euros <span>(facultatif)</span><input name="price" type="number" min="0" step="0.01" defaultValue={editing?.price ?? ''} placeholder="Laisser vide pour prix sur demande" /></label><label>Catégorie<select name="category" defaultValue={editing?.category ?? 'priced'}><option value="priced">Produit avec prix</option><option value="unpriced">Produit sans prix</option></select></label></div>
        <label>Description<textarea name="description" rows={3} defaultValue={editing?.description ?? ''} placeholder="Présentez le produit et ce qui le rend unique." /></label>
        <label>Informations complémentaires<textarea name="details" rows={3} defaultValue={editing?.details ?? ''} placeholder="Matière, taille, entretien, livraison…" /></label>
        <section className="variant-editor" aria-label="Couleurs et variantes"><div className="variant-editor-heading"><div><h3>Couleurs & photos</h3><span>Facultatif · ajoutez une photo pour chaque couleur</span></div><button type="button" className="variant-add" onClick={addVariant}><Plus size={15} /> AJOUTER UNE COULEUR</button></div>
          {variants.map((variant, index) => <article className="variant-edit-card" key={variant.id}><input type="hidden" name="variantId" value={variant.id} /><div className="variant-edit-top"><span>COULEUR {index + 1}</span><button type="button" className="icon-button delete-button" onClick={() => removeVariant(variant.id)} aria-label={`Supprimer la couleur ${index + 1}`}><Trash2 size={14} /></button></div>
            <label>Nom exact de la couleur<input name={`variantColor-${variant.id}`} defaultValue={variant.color} required placeholder="Ex. Bleu roi" /></label>
            <label className="upload-field variant-upload">{variantFileNames[variant.id] || (variant.image_url ? 'CHANGER LA PHOTO DE CETTE COULEUR' : 'AJOUTER LA PHOTO DE CETTE COULEUR')}<input type="file" name={`variantImage-${variant.id}`} accept="image/*" onChange={(event) => setVariantFileNames((current) => ({ ...current, [variant.id]: event.target.files?.[0]?.name ?? '' }))} />{variant.image_url && !variantFileNames[variant.id] && <img src={variant.image_url} alt={`Couleur ${variant.color}`} />}{editing && variant.image_url && <small>Laisser vide pour conserver cette photo.</small>}</label>
            <label className="default-variant"><input type="radio" name="defaultVariant" value={variant.id} checked={defaultVariantId === variant.id} onChange={() => setDefaultVariantId(variant.id)} /> Afficher cette couleur par défaut dans la galerie</label>
          </article>)}
          <input type="hidden" name="defaultVariant" value={defaultVariantId} />
        </section>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saving ? 'ENREGISTREMENT…' : 'ENREGISTRER'}</button>
      </form>}
      {notice && <p className={`admin-notice ${notice.includes('succès') ? 'is-success' : 'is-error'}`} role={notice.includes('succès') ? 'status' : 'alert'}>{notice.includes('succès') && <Check size={16} />}{notice}</p>}
      <section className="admin-catalog" aria-label="Catalogue des produits">
        <div className="catalog-toolbar"><div><h2>Catalogue</h2><span>{matchingProducts.length} produit{matchingProducts.length === 1 ? '' : 's'}</span></div><label className="catalog-search"><span className="search-icon">⌕</span><input type="search" value={productSearch} onChange={(event) => { setProductSearch(event.target.value); setProductPage(0) }} placeholder="Rechercher un produit ou une couleur…" aria-label="Rechercher parmi les produits" /></label></div>
        <div className="catalog-scroll"><table className="catalog-table"><thead><tr><th>PRODUIT</th><th>PRIX</th><th>COULEURS</th><th>AJOUTÉ LE</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
          {pagedProducts.map((product) => <tr key={product.id}><td><div className="catalog-product"><img src={product.variants?.find((variant) => variant.id === product.default_variant_id)?.image_url ?? product.image_url} alt="" /><span>{product.name}</span></div></td><td>{product.price !== null && product.category !== 'unpriced' ? currency.format(product.price) : 'Sur demande'}</td><td>{product.variants?.length ? product.variants.map((variant) => variant.color).join(', ') : '—'}</td><td>{new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(product.created_at))}</td><td><div className="catalog-actions"><button className="icon-button" onClick={() => { onEdit(product); setFormOpen(true) }} aria-label={`Modifier ${product.name}`}><Pencil size={15} /></button><button className="icon-button delete-button" onClick={() => void onDelete(product)} aria-label={`Supprimer ${product.name}`}><Trash2 size={15} /></button></div></td></tr>)}
          {pagedProducts.length === 0 && <tr><td className="catalog-empty" colSpan={5}>{productSearch ? 'Aucun produit ne correspond à cette recherche.' : 'Aucun produit pour le moment.'}</td></tr>}
        </tbody></table></div>
        <div className="catalog-pagination"><span>{matchingProducts.length ? `${currentPage * 10 + 1}–${Math.min((currentPage + 1) * 10, matchingProducts.length)} sur ${matchingProducts.length}` : '0 produit'}</span><div><button className="icon-button" onClick={() => setProductPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} aria-label="Page précédente"><ChevronLeft size={16} /></button><span>PAGE {currentPage + 1} / {pageCount}</span><button className="icon-button" onClick={() => setProductPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1} aria-label="Page suivante"><ChevronRight size={16} /></button></div></div>
      </section>
    </section>}
  </main>
}

function ProductDetails({ product, selectedVariantId, onVariantChange }: {
  product: Product; selectedVariantId: string; onVariantChange: (id: string) => void
}) {
  const [zoomOpen, setZoomOpen] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const didDrag = useRef(false)
  const variants = product.variants ?? []
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId)
    ?? variants.find((variant) => variant.id === product.default_variant_id)
    ?? variants[0]
  const imageUrl = selectedVariant?.image_url ?? product.image_url
  const closeZoom = () => {
    setZoomOpen(false)
    setZoomed(false)
    setPan({ x: 0, y: 0 })
    dragStart.current = null
  }
  useEffect(() => {
    setZoomOpen(false)
    setZoomed(false)
    setPan({ x: 0, y: 0 })
    dragStart.current = null
  }, [product.id, selectedVariant?.id])
  useEffect(() => {
    if (!zoomOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeZoom()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [zoomOpen])
  const toggleZoom = () => {
    setZoomed((current) => !current)
    setPan({ x: 0, y: 0 })
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || !zoomed) return
    if (Math.abs(event.clientX - dragStart.current.x) > 3 || Math.abs(event.clientY - dragStart.current.y) > 3) didDrag.current = true
    const stage = event.currentTarget.getBoundingClientRect()
    const maxX = stage.width * 0.3
    const maxY = stage.height * 0.3
    setPan({
      x: Math.max(-maxX, Math.min(maxX, dragStart.current.panX + event.clientX - dragStart.current.x)),
      y: Math.max(-maxY, Math.min(maxY, dragStart.current.panY + event.clientY - dragStart.current.y)),
    })
  }
  return <article className="product-details" onClick={(event) => event.stopPropagation()}>
    <figure className="detail-image-wrap"><button type="button" className="detail-image-button" onClick={() => setZoomOpen(true)} aria-label="Agrandir l’image"><img src={imageUrl} alt={`${product.name}${selectedVariant ? `, ${selectedVariant.color}` : ''}`} /></button><button type="button" className="zoom-toggle" onClick={() => setZoomOpen(true)}>AGRANDIR <ArrowUpRight size={13} /></button></figure>
    <div className="product-detail-copy"><p className="eyebrow">STARPHONE PARIS · PIÈCE SINGULIÈRE</p><h2>{product.name}</h2><p className="detail-price">{product.price !== null && product.category !== 'unpriced' ? currency.format(product.price) : 'Prix sur demande'}</p>
      {product.description && <p className="detail-description">{product.description}</p>}
      {product.details && <div className="detail-information"><span>INFORMATIONS</span><p>{product.details}</p></div>}
      {variants.length > 0 && <fieldset className="variant-picker"><legend>Couleur{selectedVariant ? ` · ${selectedVariant.color}` : ''}</legend><div>{variants.map((variant) => <button key={variant.id} type="button" className={`variant-choice ${selectedVariant?.id === variant.id ? 'active' : ''}`} onClick={() => onVariantChange(variant.id)} aria-label={`Choisir ${variant.color}`} title={variant.color}><img src={variant.image_url} alt="" /><span>{variant.color}</span></button>)}</div></fieldset>}
    </div>
    {zoomOpen && createPortal(<div className="image-zoom-lightbox" role="dialog" aria-modal="true" aria-label={`Agrandissement de ${product.name}`} onClick={closeZoom}>
      <button type="button" className="image-zoom-close" aria-label="Fermer l’agrandissement" onClick={closeZoom}><X size={21} /></button>
      <button type="button" className="image-zoom-control" aria-label={zoomed ? 'Réduire la photo' : 'Zoomer sur la photo'} onClick={(event) => { event.stopPropagation(); toggleZoom() }}>{zoomed ? 'RÉDUIRE' : 'ZOOMER'} <span>{zoomed ? '−' : '+'}</span></button>
      <div className={`image-zoom-stage ${zoomed ? 'is-zoomed' : ''}`} onClick={(event) => { event.stopPropagation(); if (!didDrag.current) toggleZoom(); didDrag.current = false }} onPointerDown={(event) => { if (!zoomed) return; event.currentTarget.setPointerCapture(event.pointerId); dragStart.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; didDrag.current = false }} onPointerMove={handlePointerMove} onPointerUp={() => { dragStart.current = null }} onPointerCancel={() => { dragStart.current = null; didDrag.current = false }}><img src={imageUrl} alt={`${product.name}${selectedVariant ? `, ${selectedVariant.color}` : ''} — vue agrandie`} draggable={false} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomed ? 2 : 1})` }} /></div>
      <p className="image-zoom-hint">{zoomed ? 'Cliquer sur la photo pour la réduire' : 'Cliquer sur la photo ou ZOOMER pour voir les détails'}</p>
    </div>, document.body)}
  </article>
}

createRoot(document.getElementById('app')!).render(<StrictMode><App /></StrictMode>)
