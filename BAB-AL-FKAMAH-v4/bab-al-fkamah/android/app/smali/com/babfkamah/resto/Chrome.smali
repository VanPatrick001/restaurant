.class public Lcom/babfkamah/resto/Chrome;
.super Landroid/webkit/WebChromeClient;
.source "Chrome.java"

# Ouvre la galerie / l'appareil photo quand la page demande un fichier

.field private final act:Lcom/babfkamah/resto/MainActivity;

.method public constructor <init>(Lcom/babfkamah/resto/MainActivity;)V
    .registers 2
    invoke-direct {p0}, Landroid/webkit/WebChromeClient;-><init>()V
    iput-object p1, p0, Lcom/babfkamah/resto/Chrome;->act:Lcom/babfkamah/resto/MainActivity;
    return-void
.end method

.method public onShowFileChooser(Landroid/webkit/WebView;Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient$FileChooserParams;)Z
    .registers 8
    iget-object v0, p0, Lcom/babfkamah/resto/Chrome;->act:Lcom/babfkamah/resto/MainActivity;
    iget-object v1, v0, Lcom/babfkamah/resto/MainActivity;->fichiers:Landroid/webkit/ValueCallback;
    if-eqz v1, :libre
    const/4 v2, 0x0
    invoke-interface {v1, v2}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V
    :libre
    iput-object p2, v0, Lcom/babfkamah/resto/MainActivity;->fichiers:Landroid/webkit/ValueCallback;
    :try_start
    invoke-virtual {p3}, Landroid/webkit/WebChromeClient$FileChooserParams;->createIntent()Landroid/content/Intent;
    move-result-object v1
    const/16 v2, 0x2a
    invoke-virtual {v0, v1, v2}, Lcom/babfkamah/resto/MainActivity;->startActivityForResult(Landroid/content/Intent;I)V
    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :echec
    const/4 v1, 0x1
    return v1
    :echec
    const/4 v1, 0x0
    iput-object v1, v0, Lcom/babfkamah/resto/MainActivity;->fichiers:Landroid/webkit/ValueCallback;
    invoke-interface {p2, v1}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V
    const/4 v1, 0x0
    return v1
.end method
